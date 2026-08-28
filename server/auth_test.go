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

	good, err := app.LiveKitToken("ivanov", "Иван", "seed", "")
	if err != nil {
		t.Fatal(err)
	}
	other := &App{cfg: &Config{Server: ServerConfig{LiveKit: LiveKitCfg{
		APIKey: "other-key", APISecret: "other-secret",
	}}}}
	foreign, err := other.LiveKitToken("ivanov", "Иван", "seed", "")
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
