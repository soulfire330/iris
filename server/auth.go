package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/livekit/protocol/auth"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"golang.org/x/crypto/bcrypt"
)

type App struct {
	cfg    *Config
	limits *LoginLimiter
	// invites — инвайт-ссылки гостей (JSON в data_dir, см. invites.go).
	invites *inviteStore
	// publicKey — ключ публичного API (PUBLIC_API_KEY из env); пусто — фича
	// выключена, /api/public/* отвечает 404.
	publicKey string
	livekit   *lksdk.RoomServiceClient
	egress    *lksdk.EgressClient
	// recMu — одна запись на комнату: старт/стоп сериализуем, а источник
	// правды — активные egress в LiveKit, не память.
	recMu sync.Mutex
	// activeRec — имена файлов идущих записей по комнатам: одна запись на
	// комнату, ключ — имя комнаты. Источник правды — активные egress в
	// LiveKit, память только для имени файла (см. recMu).
	activeRec map[string]string
}

type loginReq struct {
	Login    string `json:"login"`
	Password string `json:"password"`
	Room     string `json:"room"`
}

type loginResp struct {
	Token       string `json:"token"`
	Room        string `json:"room"`
	RoomDisplay string `json:"room_display"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	Login       string `json:"login"`
	Avatar      string `json:"avatar_seed"`
	TokenTTL    int    `json:"token_ttl_sec"`
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный запрос"})
		return
	}

	key := req.Login
	ip := clientIP(r)
	// Комната проверяется до пароля: список комнат публичен (/api/rooms),
	// а ошибка не светит ничего сверх него. 400, а не 401: пароль ни при чём.
	room := a.cfg.Room(req.Room)
	if room == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "неизвестная комната"})
		return
	}
	if a.limits.Blocked(key) {
		slog.Warn("login rejected: blocked", "login", key, "ip", ip)
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "слишком много попыток, подождите 5 минут"})
		return
	}

	emp := a.cfg.Employee(req.Login)
	if emp == nil {
		a.limits.Failure(key)
		slog.Warn("login rejected: unknown employee", "login", key, "ip", ip)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "неверный логин или пароль"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(req.Password)) != nil {
		a.limits.Failure(key)
		slog.Warn("login rejected: wrong password", "login", key, "ip", ip)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "неверный логин или пароль"})
		return
	}
	a.limits.Reset(key)

	// Случайный аватар на каждый вход: seed уходит в metadata токена —
	// все клиенты видят одного и того же зверя, но при новом входе — нового.
	seed := fmt.Sprintf("%s-%x", emp.Login, time.Now().UnixNano())

	token, err := a.LiveKitToken(req.Room, emp.Login, emp.Name, seed, emp.Role)
	if err != nil {
		slog.Error("login: failed to issue token", "login", key, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось выдать токен"})
		return
	}
	slog.Info("login", "login", key, "name", emp.Name, "room", req.Room, "ip", ip)

	writeJSON(w, http.StatusOK, loginResp{
		Token:       token,
		Room:        req.Room,
		RoomDisplay: room.Display,
		Name:        emp.Name,
		Role:        emp.Role,
		Login:       emp.Login,
		Avatar:      seed,
		TokenTTL:    int((6 * time.Hour).Seconds()),
	})
}

// ctxKey — ключи контекста запроса.
type ctxKey int

const tokenCtxKey ctxKey = iota

// requireToken — внутренний API под LiveKit JWT (Authorization: Bearer <токен>
// из ответа /api/login). Верификация локальная, без roundtrip в LiveKit:
// сигнатура — нашим секретом, issuer токена — наш api_key (чужой ключ — 401).
// Проверенный токен кладётся в контекст: roomFromRequest сверяет с ним
// комнату запроса (грант токена — источник правды).
// Публичными остаются /api/login, /api/healthz, /api/rooms и /api/avatar/{login}:
// картинки <img> не умеют заголовки, секретов в аватаре нет.
func (a *App) requireToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reject := func() {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "требуется авторизация"})
		}
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		t, err := auth.ParseAPIToken(raw)
		if err != nil || t.APIKey() != a.cfg.Server.LiveKit.APIKey {
			reject()
			return
		}
		if _, grants, err := t.Verify(a.cfg.Server.LiveKit.APISecret); err != nil {
			reject()
			return
		} else {
			next(w, r.WithContext(context.WithValue(r.Context(), tokenCtxKey, grants)))
		}
	}
}

// employeeOnly — гостям (role "guest" в metadata токена) недоступно
// управление записью и создание инвайтов: фронт прячет кнопки, здесь —
// запрет для прямых запросов. Пустая роль (сотрудник без роли в конфиге)
// и любые другие роли проходят.
func (a *App) employeeOnly(w http.ResponseWriter, r *http.Request) bool {
	grants, ok := r.Context().Value(tokenCtxKey).(*auth.ClaimGrants)
	if !ok || grants == nil || grants.Metadata == "" {
		return true // токены без metadata — сотрудники
	}
	var meta struct {
		Role string `json:"role"`
	}
	_ = json.Unmarshal([]byte(grants.Metadata), &meta)
	if meta.Role == "guest" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "гостю недоступно"})
		return false
	}
	return true
}

// roomFromRequest — обязательный параметр комнаты (?room=): комната из
// конфига, иначе 400. Для запросов под токеном — совпадение с грантом токена
// (иначе 403): токен выдаётся на одну комнату, а ?room= чужой — это чтение
// чужих участников и записей. Публичный API (без токена в контексте)
// проверяет только конфиг.
func (a *App) roomFromRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	room := r.URL.Query().Get("room")
	if a.cfg.Room(room) == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "неизвестная комната"})
		return "", false
	}
	if grants, ok := r.Context().Value(tokenCtxKey).(*auth.ClaimGrants); ok {
		var granted string
		if grants != nil && grants.Video != nil {
			granted = grants.Video.Room
		}
		if granted != room {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "нет доступа к комнате"})
			return "", false
		}
	}
	return room, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
