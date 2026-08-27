package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type App struct {
	cfg     *Config
	avatars *AvatarStore
	limits  *LoginLimiter
}

type loginReq struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

type loginResp struct {
	Token   string `json:"token"`
	Room    string `json:"room"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Avatar  string `json:"avatar_seed"`
	TokenTTL int   `json:"token_ttl_sec"`
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный запрос"})
		return
	}

	key := req.Login
	if a.limits.Blocked(key) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "слишком много попыток, подождите 5 минут"})
		return
	}

	emp := a.cfg.Employee(req.Login)
	if emp == nil {
		a.limits.Failure(key)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "неверный логин или пароль"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(emp.PasswordHash), []byte(req.Password)) != nil {
		a.limits.Failure(key)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "неверный логин или пароль"})
		return
	}
	a.limits.Reset(key)

	seed, err := a.avatars.Seed(emp.Login)
	if err != nil {
		log.Printf("avatars: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось создать аватар"})
		return
	}

	token, err := a.LiveKitToken(emp.Login, emp.Name, seed, emp.Role)
	if err != nil {
		log.Printf("token: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось выдать токен"})
		return
	}

	writeJSON(w, http.StatusOK, loginResp{
		Token:    token,
		Room:     a.cfg.Server.Room,
		Name:     emp.Name,
		Role:     emp.Role,
		Avatar:   seed,
		TokenTTL: int((6 * time.Hour).Seconds()),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
