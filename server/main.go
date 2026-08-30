package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/CAFxX/httpcompression"

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
		cfg:       cfg,
		limits:    NewLoginLimiter(),
		publicKey: os.Getenv("PUBLIC_API_KEY"),
		livekit:   livekitService(cfg.Server.LiveKit.Host, cfg.Server.LiveKit.APIKey, cfg.Server.LiveKit.APISecret),
		egress:    egressService(cfg.Server.LiveKit.Host, cfg.Server.LiveKit.APIKey, cfg.Server.LiveKit.APISecret),
		activeRec: map[string]string{},
	}

	// Догон дорожек участников (ADR-0005): пока запись идёт, опоздавшие
	// получают свой TrackEgress. Фоновый цикл, не блокирует API.
	go app.trackPoller()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	// Публичная поверхность — per-IP лимиты (см. rate_limit в конфиге):
	// логин отдельно (жёстче), остальное общим бакетом.
	loginLimiter := newIPLimiter(cfg.Server.RateLimit.Login)
	publicLimiter := newIPLimiter(cfg.Server.RateLimit.Public)
	mux.Handle("POST /api/login", loginLimiter(http.HandlerFunc(app.handleLogin)))
	// Список комнат публичен: селект на экране логина — до авторизации.
	mux.Handle("GET /api/rooms", publicLimiter(http.HandlerFunc(app.handleRooms)))
	// Внутренний API — под LiveKit JWT (Bearer), см. requireToken. Публичные:
	// login, rooms, healthz и аватары (картинки без заголовков).
	mux.HandleFunc("GET /api/room", app.requireToken(app.handleRoom))
	mux.Handle("GET /api/avatar/{login}", publicLimiter(http.HandlerFunc(app.handleAvatar)))
	mux.HandleFunc("POST /api/recording/start", app.requireToken(app.handleRecordingStart))
	mux.HandleFunc("POST /api/recording/stop", app.requireToken(app.handleRecordingStop))
	mux.HandleFunc("POST /api/recording/summary", app.requireToken(app.handleRecordingSummary))
	mux.HandleFunc("GET /api/recordings", app.requireToken(app.handleRecordingsList))
	mux.HandleFunc("GET /api/recordings/{name}", app.requireToken(app.handleRecordingDownload))
	// Публичный API: те же данные (список со сводками, mp4), но под ключом
	// PUBLIC_API_KEY. Статус комнаты — отдельный эндпоинт для дашбордов.
	mux.Handle("GET /api/public/recordings", publicLimiter(app.publicAuth(app.handleRecordingsList)))
	mux.Handle("GET /api/public/recordings/{name}", publicLimiter(app.publicAuth(app.handleRecordingDownload)))
	mux.Handle("GET /api/public/status", publicLimiter(app.publicAuth(app.handlePublicStatus)))
	mux.Handle("/", http.FileServer(http.Dir(cfg.Server.WebDir)))

	// Сжатие ответов (gzip/brotli по Accept-Encoding): аватары в /api/rooms
	// и /api/room — raw SVG, ужимаются в ~3 раза. mp4 не сжимаем (blacklist):
	// плееру нужны Range-запросы, библиотека их не обрабатывает при сжатии.
	compressor, err := httpcompression.DefaultAdapter(
		httpcompression.ContentTypes([]string{"video/mp4"}, true),
	)
	if err != nil {
		slog.Error("httpcompression: adapter failed", "err", err)
		os.Exit(1)
	}

	slog.Info("office: listening", "addr", cfg.Server.Listen)
	slog.Error("http", "err", http.ListenAndServe(cfg.Server.Listen, accessLog(compressor(mux))))
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
