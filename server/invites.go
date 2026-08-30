package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/livekit/protocol/livekit"
)

// maxInviteTTL — потолок жизни инвайта: бесконечных не бывает, пресеты UI
// (1ч/1д/7д/30д) не обойти прямым запросом.
const maxInviteTTL = 30 * 24 * time.Hour

// maxInviteName — потолок длины имени гостя: имя — display-only (в плитке),
// но в модалке и списках не должно раздувать строки.
const maxInviteName = 40

// Invite — гость по ссылке: имя задаёт создатель, аватар стабилен на весь
// инвайт (seed = "inv-"+token), identity в LiveKit — "inv-"+token.
type Invite struct {
	Token     string    `json:"token"`
	Room      string    `json:"room"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

var (
	errInviteNotFound = errors.New("инвайт не найден или отозван")
	errInviteExpired  = errors.New("инвайт истёк")
)

// inviteStore — инвайты в JSON-файле (data_dir/invites.json): переживают
// рестарт, отзыв работает. Запись атомарная (tmp+rename), всё под мьютексом.
// Протухшие вычищаются при загрузке и лениво при каждом чтении.
type inviteStore struct {
	mu      sync.Mutex
	path    string
	invites []Invite
}

func newInviteStore(path string) *inviteStore {
	s := &inviteStore{path: path}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &s.invites)
	}
	s.invites = s.purgeLocked()
	return s
}

// purgeLocked — выброс протухших; вызывается под mu (кроме конструктора).
func (s *inviteStore) purgeLocked() []Invite {
	now := time.Now()
	keep := s.invites[:0]
	for _, inv := range s.invites {
		if inv.ExpiresAt.After(now) {
			keep = append(keep, inv)
		}
	}
	s.invites = keep
	return keep
}

// saveLocked — атомарная запись файла (tmp + rename, не рвётся при падении).
func (s *inviteStore) saveLocked() error {
	b, err := json.MarshalIndent(s.invites, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *inviteStore) create(room, name string, ttl time.Duration) (Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv := Invite{
		Token:     newInviteToken(),
		Room:      room,
		Name:      name,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(ttl),
	}
	s.invites = append(s.invites, inv)
	if err := s.saveLocked(); err != nil {
		// 500 = инвайта нет: без отката «неудачный» инвайт жил бы в памяти
		// и ожил после следующей успешной записи файла.
		s.invites = s.invites[:len(s.invites)-1]
		return Invite{}, err
	}
	return inv, nil
}

// get — живой инвайт или errInviteNotFound / errInviteExpired. Протухшие
// здесь не вычищаем: 410 («истёк») должен отличаться от 404 («не работает»).
func (s *inviteStore) get(token string) (Invite, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for _, inv := range s.invites {
		if inv.Token != token {
			continue
		}
		if !inv.ExpiresAt.After(now) {
			return Invite{}, errInviteExpired
		}
		return inv, nil
	}
	return Invite{}, errInviteNotFound
}

// list — живые инвайты комнаты, свежие первыми.
func (s *inviteStore) list(room string) []Invite {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeLocked()
	out := make([]Invite, 0, len(s.invites))
	for _, inv := range s.invites {
		if inv.Room == room {
			out = append(out, inv)
		}
	}
	return out
}

// revoke — удаление инвайта; false, если такого не было.
func (s *inviteStore) revoke(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, inv := range s.invites {
		if inv.Token != token {
			continue
		}
		s.invites = append(s.invites[:i], s.invites[i+1:]...)
		_ = s.saveLocked()
		return true
	}
	return false
}

// newInviteToken — 256 бит случайности: токен — bearer-креденциал, его не
// подобрать перебором, а ссылка в чате = доступ в комнату.
func newInviteToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// inviteIdentity — identity гостя в LiveKit (уникален на инвайт, имя при этом
// может совпадать у двух инвайтов — это только display).
func inviteIdentity(token string) string { return "inv-" + token }

// inviteSeed — аватар гостя: стабилен на весь инвайт, страница входа
// показывает ровно того зверя, кого увидят в комнате.
func inviteSeed(token string) string { return "inv-" + token }

// inviteFromPath — токен из пути /api/invite/{token}: только hex (наш формат),
// чтобы в хранилище не ходить с мусором.
func inviteFromPath(r *http.Request) string {
	t := r.PathValue("token")
	if t == "" || len(t) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(t); err != nil {
		return ""
	}
	return t
}

// inviteError — ответ для просроченной/отозванной ссылки: 410 vs 404, чтобы
// страница гостя сказала «истёк» или «не работает».
func inviteError(w http.ResponseWriter, err error) {
	status, msg := http.StatusNotFound, errInviteNotFound.Error()
	if errors.Is(err, errInviteExpired) {
		status = http.StatusGone
		msg = errInviteExpired.Error()
	}
	writeJSON(w, status, map[string]string{"error": msg})
}

// handleInviteCreate — POST /api/invite?room= (токен, только сотрудники):
// тело {name, ttl_sec}. Имя — display гостя, ttl — от 1 минуты до
// maxInviteTTL. Ответ: токен (им параметризуется ссылка /invite/<token>).
func (a *App) handleInviteCreate(w http.ResponseWriter, r *http.Request) {
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	if !a.employeeOnly(w, r) {
		return
	}
	var req struct {
		Name   string `json:"name"`
		TTLSec int64  `json:"ttl_sec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный запрос"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > maxInviteName {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "имя: 1–40 символов"})
		return
	}
	ttl := time.Duration(req.TTLSec) * time.Second
	if ttl < time.Minute || ttl > maxInviteTTL {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ttl_sec: от 60 до 2592000"})
		return
	}
	inv, err := a.invites.create(room, name, ttl)
	if err != nil {
		slog.Error("invite: save failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось сохранить инвайт"})
		return
	}
	slog.Info("invite created", "room", room, "name", name, "ttl", ttl.String())
	writeJSON(w, http.StatusOK, map[string]any{
		"token":      inv.Token,
		"name":       inv.Name,
		"expires_at": inv.ExpiresAt,
	})
}

// handleInviteList — GET /api/invites?room= (токен, только сотрудники):
// живые инвайты комнаты — модалка «Пригласить» показывает все, чтобы чужой
// «забытый» инвайт можно было отозвать.
func (a *App) handleInviteList(w http.ResponseWriter, r *http.Request) {
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	if !a.employeeOnly(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, a.invites.list(room))
}

// handleInviteRevoke — DELETE /api/invite/{token} (токен, только сотрудники).
// Комната инвайта должна совпадать с грантом токена: отозвать можно только
// инвайт своей комнаты. Отзыв не выкидывает сидящих гостей — их LiveKit-токен
// уже выдан и живёт до истечения.
func (a *App) handleInviteRevoke(w http.ResponseWriter, r *http.Request) {
	token := inviteFromPath(r)
	if token == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "инвайт не найден"})
		return
	}
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	if !a.employeeOnly(w, r) {
		return
	}
	inv, err := a.invites.get(token)
	if err != nil || inv.Room != room {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "инвайт не найден"})
		return
	}
	a.invites.revoke(token)
	slog.Info("invite revoked", "room", room, "name", inv.Name)
	writeJSON(w, http.StatusOK, map[string]bool{"revoked": true})
}

// handleInviteInfo — GET /api/invite/{token} (публичный): страница гостя до
// входа — имя, аватар, комната, живые счётчики (участники, запись).
func (a *App) handleInviteInfo(w http.ResponseWriter, r *http.Request) {
	token := inviteFromPath(r)
	if token == "" {
		inviteError(w, errInviteNotFound)
		return
	}
	inv, err := a.invites.get(token)
	if err != nil {
		inviteError(w, err)
		return
	}
	ctx := r.Context()
	plist, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: inv.Room})
	if err != nil {
		slog.Error("invite: livekit unavailable", "room", inv.Room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	participants := make([]roomStateParticipant, 0, len(plist.Participants))
	for _, p := range plist.Participants {
		if p.Kind != livekit.ParticipantInfo_STANDARD {
			continue
		}
		participants = append(participants, roomStateParticipant{Identity: p.Identity, Name: p.Name})
	}
	a.recMu.Lock()
	recording := a.activeRec[inv.Room] != ""
	a.recMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"token":        inv.Token,
		"identity":     inviteIdentity(inv.Token),
		"name":         inv.Name,
		"room":         inv.Room,
		"room_display": a.cfg.Room(inv.Room).Display,
		"avatar_seed":  inviteSeed(inv.Token),
		"expires_at":   inv.ExpiresAt,
		"recording":    recording,
		"participants": participants,
	})
}

// handleInviteJoin — POST /api/invite/{token}/join (публичный, лимит как у
// логина): вход по ссылке — LiveKit-токен гостя. Многоразовый: каждый вход —
// новый токен, инвайт живёт до TTL или отзыва.
func (a *App) handleInviteJoin(w http.ResponseWriter, r *http.Request) {
	token := inviteFromPath(r)
	if token == "" {
		inviteError(w, errInviteNotFound)
		return
	}
	inv, err := a.invites.get(token)
	if err != nil {
		inviteError(w, err)
		return
	}
	identity := inviteIdentity(inv.Token)
	seed := inviteSeed(inv.Token)
	lkToken, err := a.LiveKitToken(inv.Room, identity, inv.Name, seed, "guest")
	if err != nil {
		slog.Error("invite: failed to issue token", "room", inv.Room, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось выдать токен"})
		return
	}
	slog.Info("invite join", "room", inv.Room, "name", inv.Name, "ip", clientIP(r))
	writeJSON(w, http.StatusOK, loginResp{
		Token:       lkToken,
		Room:        inv.Room,
		RoomDisplay: a.cfg.Room(inv.Room).Display,
		Name:        inv.Name,
		Role:        "guest",
		Login:       identity,
		Avatar:      seed,
		TokenTTL:    int((6 * time.Hour).Seconds()),
	})
}
