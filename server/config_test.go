package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestLoadConfigRooms — валидация комнат: минимум одна, имя безопасно для пути
// (идёт в recordings/<room>/), дубли запрещены, display по умолчанию — имя.
func TestLoadConfigRooms(t *testing.T) {
	write := func(t *testing.T, body string) string {
		t.Helper()
		p := filepath.Join(t.TempDir(), "config.yaml")
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	valid := `server:
  livekit: {host: localhost:7880, api_key: k, api_secret: s}
  data_dir: ./data
  web_dir: ./web-dist
rooms:
  - name: office
  - name: war-room
    display: Комната переговоров
`
	if _, err := LoadConfig(write(t, valid)); err != nil {
		t.Fatalf("валидный конфиг: %v", err)
	}

	cases := []struct {
		name string
		yaml string
	}{
		{"без комнат", "server:\n  livekit: {host: h}\n"},
		{"пустое имя", "server:\n  livekit: {host: h}\nrooms:\n  - name: \"\"\n"},
		{"имя с путём", "server:\n  livekit: {host: h}\nrooms:\n  - name: ../office\n"},
		{"дубль", "server:\n  livekit: {host: h}\nrooms:\n  - name: office\n  - name: office\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := LoadConfig(write(t, tc.yaml)); err == nil {
				t.Fatal("конфиг принят, ожидалась ошибка")
			}
		})
	}

	cfg, err := LoadConfig(write(t, valid))
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.Room("office"); got == nil || got.Display != "office" {
		t.Fatalf("display по умолчанию: %+v", got)
	}
	if got := cfg.Room("war-room"); got == nil || got.Display != "Комната переговоров" {
		t.Fatalf("display из конфига: %+v", got)
	}
	if cfg.Room("strangers") != nil {
		t.Fatal("неизвестная комната найдена")
	}
}
