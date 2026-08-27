package main

import (
	"log"
	"maps"
	"net/http"

	dicebear "github.com/dicebear/dicebear-go/v10"
	"github.com/dicebear/styles/v10"
)

// Критики в палитре Iris: фон — accent-900, тело — акцент #9184d9,
// детали — accent-300, тушь — ground #161826 (ramp из дизайн-системы).
var crittersStyle = mustStyle()

var critterOptions = map[string]any{
	"backgroundColor": []any{"2b2741"},
	"bodyColor":       []any{"9184d9"},
	"accentColor":     []any{"d2cefd"},
	"inkColor":        []any{"161826"},
	"mouthVariant": []any{
		"smile", "tinySmile", "teeth", "ooh", "line", "smirk", "wavy",
		"catMouth", "zigzag", "frown", "sad", "slant", "dot", "tooth",
	},
}

func mustStyle() *dicebear.Style {
	style, err := dicebear.NewStyle([]byte(styles.Critters))
	if err != nil {
		log.Fatalf("dicebear: %v", err)
	}
	return style
}

// handleAvatar — SVG-аватар сотрудника. Seed = логин: у сотрудника всегда
// один и тот же зверь, без хранилища. Эндпоинт без авторизации: любой seed —
// валидный ввод, секретов в ответе нет.
func (a *App) handleAvatar(w http.ResponseWriter, r *http.Request) {
	opts := maps.Clone(critterOptions)
	opts["seed"] = r.PathValue("login")

	avatar, err := dicebear.NewAvatar(crittersStyle, opts)
	if err != nil {
		log.Printf("avatar: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось нарисовать аватар"})
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write([]byte(avatar.SVG()))
}
