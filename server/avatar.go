package main

import (
	"log/slog"
	"maps"
	"net/http"
	"sync"

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
		slog.Error("dicebear: style failed to load", "err", err)
		panic(err)
	}
	return style
}

// Кэш аватаров: любой может дёргать /api/avatar/<любой>?v=<любой> или опрашивать
// /api/rooms каждые 5с — без кэша каждый запрос генерил бы SVG заново.
// Генерация идемпотентна (ключ = identity + seed), поэтому кэш из карты
// с потолком достаточен: при переполнении чистим всё, LRU не нужен.
var avatarCache = struct {
	sync.Mutex
	m map[string]string
}{m: make(map[string]string)}

const avatarCacheMax = 512

// avatarSVG — SVG аватара по ключу с кэшем. Ключ — identity+seed: один и тот
// же зверь рендерится один раз на сервер, дальше отдаётся из памяти.
func avatarSVG(key, seed string) (string, error) {
	avatarCache.Lock()
	svg, ok := avatarCache.m[key]
	avatarCache.Unlock()
	if ok {
		return svg, nil
	}

	opts := maps.Clone(critterOptions)
	opts["seed"] = seed

	avatar, err := dicebear.NewAvatar(crittersStyle, opts)
	if err != nil {
		return "", err
	}
	svg = avatar.SVG()

	avatarCache.Lock()
	if len(avatarCache.m) >= avatarCacheMax {
		avatarCache.m = make(map[string]string)
	}
	avatarCache.m[key] = svg
	avatarCache.Unlock()
	return svg, nil
}

// participantAvatar — raw SVG аватара участника (identity+seed) или пустая
// строка (нет seed/ошибка рендера). Кэш общий с /api/avatar: поллинг комнат
// зверей не перегенерирует. Сжатие — на HTTP-уровне (gzip): ответы API
// сжимаются middleware'ом, SVG-текст ужимается в ~3 раза.
func participantAvatar(identity, seed string) string {
	if seed == "" {
		return ""
	}
	svg, err := avatarSVG(identity+seed, identity+seed)
	if err != nil {
		return ""
	}
	return svg
}

// handleAvatar — SVG-аватар сотрудника. Остался для плиток комнаты (главный
// интерфейс, картинки <img> без заголовков). Seed = логин + случайный v из
// URL (клиент добавляет при входе): зверь един в рамках сессии. Эндпоинт без
// авторизации: любой seed — валидный ввод, секретов в ответе нет.
func (a *App) handleAvatar(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/svg+xml")
	// Браузеры и прокси кэшируют: URL идемпотентен, аватар живёт сессию.
	w.Header().Set("Cache-Control", "public, max-age=86400")

	seed := r.PathValue("login") + r.URL.Query().Get("v")
	svg, err := avatarSVG(r.URL.RequestURI(), seed)
	if err != nil {
		slog.Error("avatar: failed to render", "seed", seed, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось нарисовать аватар"})
		return
	}
	_, _ = w.Write([]byte(svg))
}
