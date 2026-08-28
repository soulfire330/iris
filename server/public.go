package main

// Публичный API для внешних потребителей (скрипты, боты, дашборды): записи,
// сводки и статус комнаты под ключом из PUBLIC_API_KEY (заголовок X-API-Key).
// Ключ не задан — все /api/public/* отвечают 404: фича выключена, не светим
// её существование. Список и скачивание — те же обработчики, что у
// внутреннего API: разницы в данных нет, разница только в ключе.
//
// Конфиденциальность: в логах ключ не появляется (access-лог пишет только
// метод/путь/статус), сравнение ключа — константное по времени.

import (
	"crypto/subtle"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/livekit/protocol/livekit"
)

// publicAuth — проверка X-API-Key; при любом несовпадении — 404, как будто
// эндпоинта нет.
func (a *App) publicAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.publicKey == "" ||
			subtle.ConstantTimeCompare([]byte(r.Header.Get("X-API-Key")), []byte(a.publicKey)) != 1 {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
}

// handlePublicStatus — снимок для дашбордов: идёт ли встреча (комната
// существует), сколько людей сейчас в комнате, идёт ли запись и заказана ли
// сводка. Метаданные записи — тег в метаданных комнаты (recRoomMeta), как у
// внутренних клиентов.
func (a *App) handlePublicStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	out := struct {
		RoomActive      bool   `json:"room_active"`
		NumParticipants int    `json:"num_participants"`
		Recording       bool   `json:"recording"`
		RecordingName   string `json:"recording_name,omitempty"`
		SummaryOrdered  bool   `json:"summary_ordered,omitempty"`
	}{}

	resp, err := a.livekit.ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{a.cfg.Server.Room}})
	if err != nil {
		slog.Error("public status: livekit unavailable", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	if len(resp.Rooms) > 0 {
		out.RoomActive = true
		var meta struct {
			Recording bool   `json:"recording"`
			Summary   bool   `json:"summary"`
			RecName   string `json:"rec_name"`
		}
		_ = json.Unmarshal([]byte(resp.Rooms[0].Metadata), &meta)
		out.Recording = meta.Recording
		out.SummaryOrdered = meta.Summary
		out.RecordingName = meta.RecName
	}

	plist, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: a.cfg.Server.Room})
	if err != nil {
		slog.Error("public status: participants unavailable", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	for _, p := range plist.Participants {
		if p.Kind == livekit.ParticipantInfo_STANDARD {
			out.NumParticipants++
		}
	}

	writeJSON(w, http.StatusOK, out)
}
