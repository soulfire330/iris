package main

import (
	"flag"
	"log"
	"net/http"
	"os"
)

func main() {
	cfgPath := flag.String("config", "config.yaml", "путь к config.yaml")
	flag.Parse()

	cfg, err := LoadConfig(*cfgPath)
	if err != nil {
		log.Fatalf("конфиг: %v", err)
	}
	if err := os.MkdirAll(cfg.Server.DataDir, 0o755); err != nil {
		log.Fatalf("data_dir: %v", err)
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

	log.Printf("office: слушаю %s", cfg.Server.Listen)
	log.Fatal(http.ListenAndServe(cfg.Server.Listen, mux))
}
