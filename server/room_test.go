package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestHandleRoomsUnavailable — /api/rooms публичен (без токена), а при
// недоступном LiveKit отвечает 502: экран входа показывает «сервер не
// отвечает» и продолжает опрашивать. Успешный путь живёт в e2e (нужен
// настоящий LiveKit): на моке участников не получить.
func TestHandleRoomsUnavailable(t *testing.T) {
	app := &App{
		cfg: &Config{Rooms: []RoomCfg{{Name: "office"}, {Name: "war-room"}}},
		// Порт 1 — соединение отклоняется: livekit недоступен.
		livekit: livekitService("127.0.0.1:1", "k", "s"),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/rooms", nil)
	rec := httptest.NewRecorder()
	app.handleRooms(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d: want 502", rec.Code)
	}
}
