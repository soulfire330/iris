package main

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

// livekitService — клиент Server API LiveKit. Схему дописываем сами: в конфиге
// host без схемы (localhost:7880), а twirp-клиент требует полный URL.
func livekitService(host, apiKey, apiSecret string) *lksdk.RoomServiceClient {
	if !strings.Contains(host, "://") {
		host = "http://" + host
	}
	return lksdk.NewRoomServiceClient(host, apiKey, apiSecret)
}

// handleRoom — общий таймер комнаты. started_at_ms — момент входа первого
// участника (creation_time комнаты в LiveKit: комната живёт, пока в ней
// кто-то есть + empty_timeout, и исчезает, когда все вышли). server_now_ms —
// часы сервера, по ним клиент выравнивает тик и не зависит от часов машины.
func (a *App) handleRoom(w http.ResponseWriter, r *http.Request) {
	resp, err := a.livekit.ListRooms(r.Context(), &livekit.ListRoomsRequest{Names: []string{a.cfg.Server.Room}})
	if err != nil {
		log.Printf("room: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}

	out := struct {
		StartedAtMs int64 `json:"started_at_ms"`
		ServerNowMs int64 `json:"server_now_ms"`
	}{ServerNowMs: time.Now().UnixMilli()}

	// 0 — комната пуста: клиент пока держит локальный якорь и переспрашивает.
	if len(resp.Rooms) > 0 {
		out.StartedAtMs = resp.Rooms[0].CreationTime * 1000
		if ms := resp.Rooms[0].CreationTimeMs; ms != 0 {
			out.StartedAtMs = ms
		}
	}
	writeJSON(w, http.StatusOK, out)
}
