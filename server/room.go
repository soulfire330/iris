package main

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
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

// handleRoom — общий таймер комнаты и снимок присутствующих. Комната —
// обязательный ?room= (roomFromRequest: из конфига, для токена — совпадение с
// грантом). started_at_ms — момент входа первого участника (creation_time
// комнаты в LiveKit: комната живёт, пока в ней кто-то есть + empty_timeout, и
// исчезает, когда все вышли). server_now_ms — часы сервера, по ним клиент
// выравнивает тик и не зависит от часов машины. participants — люди в комнате
// сейчас (без egress-бота записи): клиент рисует их плитки с лоадером, пока
// сам ещё подключается. num_participants = len(participants).
func (a *App) handleRoom(w http.ResponseWriter, r *http.Request) {
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	resp, err := a.livekit.ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{room}})
	if err != nil {
		slog.Error("room: livekit unavailable", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}

	out := struct {
		StartedAtMs     int64             `json:"started_at_ms"`
		ServerNowMs     int64             `json:"server_now_ms"`
		NumParticipants int               `json:"num_participants"`
		Participants    []roomParticipant `json:"participants"`
	}{ServerNowMs: time.Now().UnixMilli(), Participants: []roomParticipant{}}

	// 0 — комната пуста: клиент пока держит локальный якорь и переспрашивает.
	if len(resp.Rooms) > 0 {
		out.StartedAtMs = resp.Rooms[0].CreationTime * 1000
		if ms := resp.Rooms[0].CreationTimeMs; ms != 0 {
			out.StartedAtMs = ms
		}
	}

	plist, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: room})
	if err != nil {
		slog.Error("room: participants unavailable", "err", err)
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

// handleRooms — публичный список комнат для экрана логина (до авторизации):
// порядок — как в конфиге, display — подпись в селекте. Сверху статики —
// живое состояние: участники (identity — логин, для проверки «логин уже в
// комнате»; первые три дают аватары), счётчик и идёт ли запись. Секретов
// нет: имя комнаты и так видно в конфиге LiveKit.
// LiveKit недоступен — 502: экран входа показывает «сервер не отвечает».
func (a *App) handleRooms(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := make([]roomState, 0, len(a.cfg.Rooms))
	for _, rc := range a.cfg.Rooms {
		st := roomState{Name: rc.Name, Display: rc.Display, Participants: []roomStateParticipant{}}
		plist, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: rc.Name})
		if err != nil {
			slog.Error("rooms: livekit unavailable", "room", rc.Name, "err", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
			return
		}
		// Имя участника приходит от LiveKit (SetName в токене). Egress-бот
		// записи людям не участник (kind != STANDARD).
		for _, p := range plist.Participants {
			if p.Kind != livekit.ParticipantInfo_STANDARD {
				continue
			}
			// Seed — из metadata токена: тот же зверь, что в комнате
			// (см. roomParticipant в handleRoom).
			var meta struct {
				Seed string `json:"seed"`
			}
			_ = json.Unmarshal([]byte(p.Metadata), &meta)
			pp := roomStateParticipant{Identity: p.Identity, Name: p.Name, Seed: meta.Seed}
			// Аватары первым трём участникам — столько их видно на экране входа;
			// остальным не отдаём (payload и генерация по минимуму).
			if len(st.Participants) < 3 && meta.Seed != "" {
				if svg, err := avatarSVG(p.Identity+meta.Seed, p.Identity+meta.Seed); err == nil {
					pp.Avatar = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(svg))
				}
			}
			st.Participants = append(st.Participants, pp)
		}
		a.recMu.Lock()
		_, st.Recording = a.activeRec[rc.Name]
		a.recMu.Unlock()
		out = append(out, st)
	}
	writeJSON(w, http.StatusOK, out)
}

type roomState struct {
	Name         string                 `json:"name"`
	Display      string                 `json:"display"`
	Recording    bool                   `json:"recording"`
	Participants []roomStateParticipant `json:"participants"` // полный список: счётчик = len
}

type roomStateParticipant struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	Seed     string `json:"seed,omitempty"`
	// Avatar — data URI первых трёх участников: экран входа рисует аватар
	// без обращения к /api/avatar (публичная поверхность меньше).
	Avatar string `json:"avatar,omitempty"`
}

type roomParticipant struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	Seed     string `json:"seed,omitempty"`
	Role     string `json:"role,omitempty"`
}
