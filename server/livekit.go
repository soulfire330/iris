package main

import (
	"encoding/json"

	"github.com/livekit/protocol/auth"
)

// LiveKitToken собирает JWT для входа в комнату. metadata — JSON {seed, role},
// по нему фронт рисует плитку участника (имя уходит через SetName).
func (a *App) LiveKitToken(login, name, avatarSeed, role string) (string, error) {
	meta, _ := json.Marshal(map[string]string{"seed": avatarSeed, "role": role})

	at := auth.NewAccessToken(a.cfg.Server.LiveKit.APIKey, a.cfg.Server.LiveKit.APISecret)
	at.SetVideoGrant(&auth.VideoGrant{
		RoomJoin: true,
		Room:     a.cfg.Server.Room,
	})
	at.SetIdentity(login).SetName(name).SetMetadata(string(meta))
	return at.ToJWT()
}
