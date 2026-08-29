package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestIPLimiter — токен-бакет: burst запросов проходит, следующий — 429 с
// Retry-After; X-Forwarded-For учитывается только от loopback-пира (Caddy),
// подделка заголовка напрямую не влияет на бакетку.
func TestIPLimiter(t *testing.T) {
	cfg := RateLimitBucket{Rate: 5, Burst: 3}
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	limited := newIPLimiter(cfg)(ok)

	req := func(xff, remote string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
		r.RemoteAddr = remote
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		rec := httptest.NewRecorder()
		limited.ServeHTTP(rec, r)
		return rec
	}

	for i := 0; i < cfg.Burst; i++ {
		if rec := req("10.0.0.1", "127.0.0.1:1234"); rec.Code != http.StatusOK {
			t.Fatalf("запрос %d из burst: статус %d, want 200", i+1, rec.Code)
		}
	}
	rec := req("10.0.0.1", "127.0.0.1:1234")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("после burst: статус %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("нет Retry-After в 429")
	}
	// Подделка XFF при прямом коннекте (не loopback): ключ — RemoteAddr,
	// чужая бакетка, запрос проходит.
	if rec := req("10.0.0.1", "192.0.2.1:1234"); rec.Code != http.StatusOK {
		t.Fatalf("спуфинг XFF: статус %d, want 200", rec.Code)
	}
}
