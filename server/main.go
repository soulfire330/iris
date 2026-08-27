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
		avatars: NewAvatarStore(cfg.Server.DataDir),
		limits:  NewLoginLimiter(),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /api/login", app.handleLogin)
	mux.Handle("/", http.FileServer(http.Dir(cfg.Server.WebDir)))

	log.Printf("office: слушаю %s", cfg.Server.Listen)
	log.Fatal(http.ListenAndServe(cfg.Server.Listen, mux))
}
