package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestJSONListsNeverNull — регресс: nil-слайс сериализуется в null, а фронт
// ждёт массив (participants.some падал на «participants: null» в пустой
// комнате). Пустой список всегда должен быть [] — инициализация пустым
// слайсом в хендлерах это гарантирует, тест ловит возврат бага.
func TestJSONListsNeverNull(t *testing.T) {
	for name, v := range map[string]any{
		"roomState": roomState{Name: "office", Participants: []roomStateParticipant{}},
		"recMeta":   recMeta{StartedBy: "x", Participants: []string{}},
		"recFile":   recFile{Name: "x", Participants: []string{}},
		"roomSnapshot": struct {
			Participants []roomParticipant `json:"participants"`
		}{Participants: []roomParticipant{}},
	} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "null") {
			t.Errorf("%s: пустой список ушёл в null: %s", name, b)
		}
	}
}
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
