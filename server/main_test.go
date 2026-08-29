package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/CAFxX/httpcompression"
)

// compressor — как в main: DefaultAdapter с blacklist video/mp4.
func compressor(t *testing.T) func(http.Handler) http.Handler {
	t.Helper()
	c, err := httpcompression.DefaultAdapter(
		httpcompression.ContentTypes([]string{"video/mp4"}, true),
	)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// TestCompression — сжатие ответов: gzip по Accept-Encoding, mp4 (Range-запросы
// ServeFile) не трогаем, без Accept-Encoding не сжимаем. Распаковываем тело
// и сверяем. Тело больше DefaultMinSize (200B), иначе адаптер не буферизует.
func TestCompression(t *testing.T) {
	body := bytes.Repeat([]byte(`{"avatar": "<svg viewBox=\"0 0 100 100\"><path d=\"M0 0L100 100Z\"/></svg>"}`), 8)

	cases := []struct {
		name           string
		contentType    string
		acceptEncoding string
		wantGzip       bool
	}{
		{"json сжимается", "application/json", "gzip", true},
		{"без Accept-Encoding не сжимаем", "application/json", "", false},
		{"mp4 не сжимаем", "video/mp4", "gzip", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := compressor(t)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if c.contentType != "" {
					w.Header().Set("Content-Type", c.contentType)
				}
				_, _ = w.Write(body)
			}))
			req := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
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
				t.Fatalf("тело искажено: %q", raw[:80])
			}
		})
	}
}

// TestCompressionVary — Vary: Accept-Encoding ставится всегда: кэши не
// отдадут сжатый ответ клиенту, который сжатие не понимает.
func TestCompressionVary(t *testing.T) {
	h := compressor(t)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), 500))
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/rooms", nil))
	if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("Vary без Accept-Encoding: %q", rec.Header().Get("Vary"))
	}
}
