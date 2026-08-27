package main

import (
	"encoding/json"
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

// handleRoom — общий таймер комнаты и снимок присутствующих. started_at_ms —
// момент входа первого участника (creation_time комнаты в LiveKit: комната
// живёт, пока в ней кто-то есть + empty_timeout, и исчезает, когда все
// вышли). server_now_ms — часы сервера, по ним клиент выравнивает тик и не
// зависит от часов машины. participants — люди в комнате сейчас (без
// egress-бота записи): клиент рисует их плитки с лоадером, пока сам ещё
// подключается. num_participants = len(participants).
func (a *App) handleRoom(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	resp, err := a.livekit.ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{a.cfg.Server.Room}})
	if err != nil {
		log.Printf("room: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}

	out := struct {
		StartedAtMs     int64             `json:"started_at_ms"`
		ServerNowMs     int64             `json:"server_now_ms"`
		NumParticipants int               `json:"num_participants"`
		Participants    []roomParticipant `json:"participants"`
	}{ServerNowMs: time.Now().UnixMilli()}

	// 0 — комната пуста: клиент пока держит локальный якорь и переспрашивает.
	if len(resp.Rooms) > 0 {
		out.StartedAtMs = resp.Rooms[0].CreationTime * 1000
		if ms := resp.Rooms[0].CreationTimeMs; ms != 0 {
			out.StartedAtMs = ms
		}
	}

	plist, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: a.cfg.Server.Room})
	if err != nil {
		log.Printf("room participants: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	// Имя участника приходит от LiveKit (SetName в токене), seed/role — из
	// metadata токена. Egress-бот записи людям не участник.
	for _, p := range plist.Participants {
		if p.Kind != livekit.ParticipantInfo_STANDARD {
			continue
		}
		var meta struct {
			Seed string `json:"seed"`
			Role string `json:"role"`
		}
		_ = json.Unmarshal([]byte(p.Metadata), &meta)
		out.Participants = append(out.Participants, roomParticipant{
			Identity: p.Identity,
			Name:     p.Name,
			Seed:     meta.Seed,
			Role:     meta.Role,
		})
	}
	out.NumParticipants = len(out.Participants)
	writeJSON(w, http.StatusOK, out)
}

type roomParticipant struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	Seed     string `json:"seed,omitempty"`
	Role     string `json:"role,omitempty"`
}
