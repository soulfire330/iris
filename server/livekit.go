package main

import (
	"encoding/json"

	"github.com/livekit/protocol/auth"
)

// LiveKitToken собирает JWT для входа в комнату room. metadata — JSON
// {seed, role}, по нему фронт рисует плитку участника (имя уходит через
// SetName). Грант токена — на одну комнату: по нему бэкенд сверяет ?room= в
// запросах (roomFromRequest).
func (a *App) LiveKitToken(room, login, name, avatarSeed, role string) (string, error) {
	meta, _ := json.Marshal(map[string]string{"seed": avatarSeed, "role": role})

	at := auth.NewAccessToken(a.cfg.Server.LiveKit.APIKey, a.cfg.Server.LiveKit.APISecret)
	at.SetVideoGrant(&auth.VideoGrant{
		RoomJoin: true,
		Room:     room,
	})
	at.SetIdentity(login).SetName(name).SetMetadata(string(meta))
	return at.ToJWT()
}
