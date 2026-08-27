package main

import (
	"github.com/livekit/protocol/auth"
)

// LiveKitToken собирает JWT для входа в комнату. metadata — seed аватара,
// по нему фронт рисует аватар участника (name уходит через SetName).
func (a *App) LiveKitToken(login, name, avatarSeed string) (string, error) {
	at := auth.NewAccessToken(a.cfg.Server.LiveKit.APIKey, a.cfg.Server.LiveKit.APISecret)
	at.SetVideoGrant(&auth.VideoGrant{
		RoomJoin: true,
		Room:     a.cfg.Server.Room,
	})
	at.SetIdentity(login).SetName(name).SetMetadata(avatarSeed)
	return at.ToJWT()
}
