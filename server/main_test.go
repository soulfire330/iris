package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestGzipMiddleware — сжатие ответов: gzip только по Accept-Encoding, mp4
// (Range-запросы ServeFile) не трогаем. Распаковываем тело и сверяем.
func TestGzipMiddleware(t *testing.T) {
	body := []byte(`{"avatar": "<svg>...</svg>"}`)
	h := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(body)
	}))

	cases := []struct {
		name           string
		path           string
		acceptEncoding string
		wantGzip       bool
	}{
		{"обычный ответ сжимается", "/api/rooms", "gzip, deflate, br", true},
		{"без Accept-Encoding не сжимаем", "/api/rooms", "", false},
		{"mp4 не сжимаем", "/api/recordings/2025-06-11_14-30_ivanov.mp4?room=office", "gzip", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, c.path, nil)
			req.Header.Set("Accept-Encoding", c.acceptEncoding)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if got := rec.Header().Get("Content-Encoding") == "gzip"; got != c.wantGzip {
				t.Fatalf("Content-Encoding gzip: got %v, want %v", got, c.wantGzip)
			}
			raw := rec.Body.Bytes()
			if c.wantGzip {
				zr, err := gzip.NewReader(bytes.NewReader(raw))
				if err != nil {
					t.Fatal(err)
				}
				raw, err = io.ReadAll(zr)
				if err != nil {
					t.Fatal(err)
				}
			}
			if !bytes.Equal(raw, body) {
				t.Fatalf("тело искажено: %q", raw)
			}
		})
	}
}
