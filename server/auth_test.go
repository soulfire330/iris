package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRequireToken — внутренний API под LiveKit JWT: без заголовка, с мусором
// и с токеном от чужого ключа — 401; со своим токеном — доступ.
func TestRequireToken(t *testing.T) {
	app := &App{cfg: &Config{Server: ServerConfig{LiveKit: LiveKitCfg{
		APIKey: "key", APISecret: "secret",
	}}}}
	ok := app.requireToken(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	good, err := app.LiveKitToken("office", "ivanov", "Иван", "seed", "")
	if err != nil {
		t.Fatal(err)
	}
	other := &App{cfg: &Config{Server: ServerConfig{LiveKit: LiveKitCfg{
		APIKey: "other-key", APISecret: "other-secret",
	}}}}
	foreign, err := other.LiveKitToken("office", "ivanov", "Иван", "seed", "")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		auth     string
		expected int
	}{
		{"без заголовка", "", http.StatusUnauthorized},
		{"мусор", "Bearer not-a-token", http.StatusUnauthorized},
		{"чужой ключ", "Bearer " + foreign, http.StatusUnauthorized},
		{"верный токен", "Bearer " + good, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/room", nil)
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			rec := httptest.NewRecorder()
			ok(rec, req)
			if rec.Code != tc.expected {
				t.Fatalf("status: %d, want %d", rec.Code, tc.expected)
			}
		})
	}
}

// TestRoomFromRequest — обязательный ?room=: комната вне конфига — 400;
// комната, не совпадающая с грантом токена, — 403 (иначе по чужому токену
// читается чужая комната); без токена (публичный API) — только конфиг.
func TestRoomFromRequest(t *testing.T) {
	app := &App{cfg: &Config{
		Server: ServerConfig{LiveKit: LiveKitCfg{APIKey: "key", APISecret: "secret"}},
		Rooms:  []RoomCfg{{Name: "office", Display: "Офис"}, {Name: "war-room"}},
	}}
	ok := app.requireToken(func(w http.ResponseWriter, r *http.Request) {
		room, ok := app.roomFromRequest(w, r)
		if !ok {
			return
		}
		w.Write([]byte(room))
	})
	// Публичный API (например /api/public/status): токена нет, только конфиг.
	public := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		room, ok := app.roomFromRequest(w, r)
		if !ok {
			return
		}
		w.Write([]byte(room))
	})

	token, err := app.LiveKitToken("office", "ivanov", "Иван", "seed", "")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name     string
		room     string
		auth     bool
		expected int
		body     string
	}{
		{"своя комната", "office", true, http.StatusOK, "office"},
		{"чужая комната под токеном", "war-room", true, http.StatusForbidden, ""},
		{"комната вне конфига", "strangers", true, http.StatusBadRequest, ""},
		{"нет параметра", "", true, http.StatusBadRequest, ""},
		{"публичный API: комната из конфига", "office", false, http.StatusOK, "office"},
		{"публичный API: вне конфига", "strangers", false, http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/room?room="+tc.room, nil)
			if tc.auth {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			rec := httptest.NewRecorder()
			h := http.Handler(ok)
			if !tc.auth {
				h = public
			}
			h.ServeHTTP(rec, req)
			if rec.Code != tc.expected || (tc.expected == http.StatusOK && rec.Body.String() != tc.body) {
				t.Fatalf("status %d body %q: want %d %q", rec.Code, rec.Body.String(), tc.expected, tc.body)
			}
		})
	}
}
