package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"office/internal/logging"
)

func main() {
	logging.Setup()

	cfgPath := flag.String("config", "config.yaml", "путь к config.yaml")
	flag.Parse()

	cfg, err := LoadConfig(*cfgPath)
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.Server.DataDir, 0o755); err != nil {
		slog.Error("data_dir", "err", err)
		os.Exit(1)
	}

	app := &App{
		cfg:     cfg,
		limits:  NewLoginLimiter(),
		livekit: livekitService(cfg.Server.LiveKit.Host, cfg.Server.LiveKit.APIKey, cfg.Server.LiveKit.APISecret),
		egress:  egressService(cfg.Server.LiveKit.Host, cfg.Server.LiveKit.APIKey, cfg.Server.LiveKit.APISecret),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/login", app.handleLogin)
	mux.HandleFunc("GET /api/room", app.handleRoom)
	mux.HandleFunc("GET /api/avatar/{login}", app.handleAvatar)
	mux.HandleFunc("POST /api/recording/start", app.handleRecordingStart)
	mux.HandleFunc("POST /api/recording/stop", app.handleRecordingStop)
	mux.HandleFunc("POST /api/recording/summary", app.handleRecordingSummary)
	mux.HandleFunc("GET /api/recordings", app.handleRecordingsList)
	mux.HandleFunc("GET /api/recordings/{name}", app.handleRecordingDownload)
	mux.Handle("/", http.FileServer(http.Dir(cfg.Server.WebDir)))

	slog.Info("office: listening", "addr", cfg.Server.Listen)
	slog.Error("http", "err", http.ListenAndServe(cfg.Server.Listen, accessLog(mux)))
	os.Exit(1)
}

// accessLog — строка на каждый HTTP-запрос: IP, метод, путь, статус, мс.
// Детали (логин, имя файла) — в событиях обработчиков, здесь только
// факт запроса и его исход.
func accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRec{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("http",
			"ip", clientIP(r),
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusRec struct {
	http.ResponseWriter
	status int // 200, если handler не вызвал WriteHeader
}

func (r *statusRec) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// clientIP — реальный IP за Caddy (первое значение X-Forwarded-For) или
// RemoteAddr, если прокси нет. Для логов; не доверяем, просто показываем.
func clientIP(r *http.Request) string {
	ip := r.Header.Get("X-Forwarded-For")
	if i := strings.Index(ip, ","); i >= 0 {
		ip = ip[:i]
	}
	if ip == "" {
		ip = r.RemoteAddr
	}
	return ip
}
