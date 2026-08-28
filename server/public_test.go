package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestPublicAuth — публичный API закрыт ключом: без ключа, с неверным и с
// верным X-API-Key; без настроенного ключа эндпоинты выключены (404).
func TestPublicAuth(t *testing.T) {
	app := &App{publicKey: "secret-key"}
	ok := app.publicAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	cases := []struct {
		name     string
		key      string
		expected int
	}{
		{"без ключа", "", http.StatusNotFound},
		{"неверный ключ", "wrong", http.StatusNotFound},
		{"верный ключ", "secret-key", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/public/status", nil)
			if tc.key != "" {
				req.Header.Set("X-API-Key", tc.key)
			}
			rec := httptest.NewRecorder()
			ok(rec, req)
			if rec.Code != tc.expected {
				t.Fatalf("status: %d, want %d", rec.Code, tc.expected)
			}
		})
	}

	// Ключ не задан — фича выключена, даже верный заголовок не открывает.
	off := (&App{}).publicAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/public/status", nil)
	req.Header.Set("X-API-Key", "secret-key")
	rec := httptest.NewRecorder()
	off(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("без настроенного ключа: %d, want 404", rec.Code)
	}
}
