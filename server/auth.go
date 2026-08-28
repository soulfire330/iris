package main

import (
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
	// publicKey — ключ публичного API (PUBLIC_API_KEY из env); пусто — фича
	// выключена, /api/public/* отвечает 404.
	publicKey string
	livekit   *lksdk.RoomServiceClient
	egress    *lksdk.EgressClient
	// recMu — одна запись на комнату: старт/стоп сериализуем, а источник
	// правды — активные egress в LiveKit, не память.
	recMu sync.Mutex
	// activeRecName — имя файла идущей записи. FileResults у активного egress
	// может быть пуст до финализации, а заказ сводки должен попасть в sidecar
	// именно этой записи — имя запоминаем при старте (статус записи — по-прежнему LiveKit).
	activeRecName string
}

type loginReq struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type loginResp struct {
	Token    string `json:"token"`
	Room     string `json:"room"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Login    string `json:"login"`
	Avatar   string `json:"avatar_seed"`
	TokenTTL int    `json:"token_ttl_sec"`
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный запрос"})
		return
	}

	key := req.Login
	ip := clientIP(r)
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

	token, err := a.LiveKitToken(emp.Login, emp.Name, seed, emp.Role)
	if err != nil {
		slog.Error("login: failed to issue token", "login", key, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось выдать токен"})
		return
	}
	slog.Info("login", "login", key, "name", emp.Name, "ip", ip)

	writeJSON(w, http.StatusOK, loginResp{
		Token:    token,
		Room:     a.cfg.Server.Room,
		Name:     emp.Name,
		Role:     emp.Role,
		Login:    emp.Login,
		Avatar:   seed,
		TokenTTL: int((6 * time.Hour).Seconds()),
	})
}

// requireToken — внутренний API под LiveKit JWT (Authorization: Bearer <токен>
// из ответа /api/login). Верификация локальная, без roundtrip в LiveKit:
// сигнатура — нашим секретом, issuer токена — наш api_key (чужой ключ — 401).
// Публичными остаются /api/login, /api/healthz и /api/avatar/{login}:
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
		if _, _, err := t.Verify(a.cfg.Server.LiveKit.APISecret); err != nil {
			reject()
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
