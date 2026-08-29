package main

// Запись комнаты — серверная, через LiveKit Egress (ADR-0002): audio-only
// RoomComposite в MP4, файл в общем volume, старт/стоп — кнопкой. Одна запись
// на комнату; источник правды — активные egress в LiveKit (ListEgress), а не
// память бэкенда: переживает рестарт бэкенда и самоостановку egress при
// опустении комнаты. Статус для клиентов — метаданные комнаты: бэкенд пишет
// {"recording":true} при старте и "" при стопе, фронт слушает
// roomMetadataChanged.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

// egressOutDir — путь, по которому egress-контейнер видит каталог записей
// (deploy/docker-compose.yml: ../data/recordings:/out/recordings). Имена файлов
// обязаны совпадать у egress (пишет) и бэкенда (список/скачивание).
const egressOutDir = "/out/recordings"

// Метаданные комнаты при активной записи; пустая строка — нет. rec_started_at
// (RFC3339, серверное время) — старт записи: фронт показывает его в живой
// строке «Сейчас, 11:17 · 49 мин» и считает длительность от него. rec_name —
// имя файла: по нему фронт сопоставляет запись в списке и держит строку
// «сохранение» ровно до появления файла. Summary-вариант заказывает AI-сводку
// (эпик «Секретарь»): тот же egress, но sidecar записи получает флаг summary —
// по нему воркер-секретарь найдёт файл после стопа.
func recRoomMeta(name string, startedAt time.Time) string {
	return fmt.Sprintf(
		`{"recording":true,"rec_started_at":%q,"rec_name":%q}`,
		startedAt.Format(time.RFC3339), name,
	)
}

func recRoomMetaSummary(name, startedAt string) string {
	return fmt.Sprintf(`{"recording":true,"summary":true,"rec_started_at":%q,"rec_name":%q}`, startedAt, name)
}

// recNameRe — имя файла записи: 2025-06-11_14-30_ivanov.mp4, коллизии — суффикс -2.
var recNameRe = regexp.MustCompile(`^[\w.-]+\.mp4$`)

// loginRe — логин из тела запроса, попадающий в имя файла записи и sidecar:
// только безопасные для пути символы. Без проверки логин с «..» утаскивает
// запись за пределы каталога (перезапись чужих файлов).
var loginRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// egressService — клиент Egress API LiveKit (схему дописываем, как в room.go).
func egressService(host, apiKey, apiSecret string) *lksdk.EgressClient {
	if !strings.Contains(host, "://") {
		host = "http://" + host
	}
	return lksdk.NewEgressClient(host, apiKey, apiSecret)
}

func (a *App) recordingsDir() string {
	return filepath.Join(a.cfg.Server.DataDir, "recordings")
}

// activeRecording — активный egress комнаты или nil.
func (a *App) activeRecording(ctx context.Context, room string) (*livekit.EgressInfo, error) {
	resp, err := a.egress.ListEgress(ctx, &livekit.ListEgressRequest{RoomName: room, Active: true})
	if err != nil {
		return nil, err
	}
	if len(resp.Items) == 0 {
		return nil, nil
	}
	return resp.Items[0], nil
}

// recordingName — имя файла «дата-время_логин.mp4», свободное в каталоге.
func recordingName(dir string, t time.Time, login string) string {
	base := t.Format("2006-01-02_15-04") + "_" + login
	name := base + ".mp4"
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); errors.Is(err, os.ErrNotExist) {
			return name
		}
		name = base + "-" + strconv.Itoa(i) + ".mp4"
	}
}

// recMeta — sidecar-json у mp4: кто начал, кто был в комнате на стопе и заказана
// ли AI-сводка. Пишется сразу при старте (флаг summary должен пережить стоп и
// рестарты), на стопе дополняется участниками и временем.
type recMeta struct {
	StartedBy    string   `json:"started_by"`
	StartedAt    string   `json:"started_at"`
	StoppedAt    string   `json:"stopped_at"`
	Participants []string `json:"participants"`
	Summary      bool     `json:"summary,omitempty"`
}

// roomDir — каталог записей комнаты: recordings/<room>/. Записи разных комнат
// не смешиваются, подкаталог создаётся при старте записи (egress пишет в
// volume по тому же относительному пути).
func (a *App) roomDir(room string) string {
	return filepath.Join(a.recordingsDir(), room)
}

// handleRecordingStart — POST /api/recording/start?room=. Тело: {login}. 409,
// если запись уже идёт; имя файла берёт на себя бэкенд, egress пишет в volume.
// AI-сводка кнопкой не стартуется — заказывается отдельно при идущей записи
// (handleRecordingSummary).
func (a *App) handleRecordingStart(w http.ResponseWriter, r *http.Request) {
	a.recMu.Lock()
	defer a.recMu.Unlock()

	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	var req struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Login == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный запрос"})
		return
	}
	if !loginRe.MatchString(req.Login) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный логин"})
		return
	}

	ctx := r.Context()
	if active, err := a.activeRecording(ctx, room); err != nil {
		slog.Error("recording: livekit unavailable", "op", "start", "room", room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	} else if active != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "запись уже идёт"})
		return
	}

	dir := a.roomDir(room)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slog.Error("recording: failed to create dir", "room", room, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось создать каталог записей"})
		return
	}
	name := recordingName(dir, time.Now(), req.Login)

	info, err := a.egress.StartRoomCompositeEgress(ctx, &livekit.RoomCompositeEgressRequest{
		RoomName:  room,
		AudioOnly: true,
		Output: &livekit.RoomCompositeEgressRequest_File{File: &livekit.EncodedFileOutput{
			FileType:        livekit.EncodedFileType_MP4,
			Filepath:        filepath.Join(egressOutDir, room, name),
			DisableManifest: true, // свой sidecar пишем сами, манифесты egress не нужны
		}},
	})
	if err != nil {
		slog.Error("recording: failed to start", "room", room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "не удалось начать запись"})
		return
	}

	// Метаданные комнаты — единственный канал статуса для клиентов. Если не
	// обновились, egress уже идёт, но тега ни у кого не будет — лог на потом.
	if _, err := a.livekit.UpdateRoomMetadata(ctx, &livekit.UpdateRoomMetadataRequest{
		Room: room, Metadata: recRoomMeta(name, time.Now()),
	}); err != nil {
		slog.Warn("recording: room metadata not updated", "name", name, "err", err)
	}

	// Sidecar пишем сразу, а не на стопе: egress может завершиться сам (комната
	// опустела), и тогда без него записи не будет в списке. Флаг summary сюда
	// попадает позже — из handleRecordingSummary.
	a.activeRec[room] = name
	if b, err := json.Marshal(recMeta{
		StartedBy: req.Login,
		StartedAt: time.Unix(0, info.StartedAt).Format(time.RFC3339), // StartedAt — наносекунды
	}); err == nil {
		if err := os.WriteFile(filepath.Join(dir, strings.TrimSuffix(name, ".mp4")+".json"), b, 0o644); err != nil {
			slog.Error("recording: sidecar write failed", "name", name, "err", err)
		}
	}

	slog.Info("recording started", "room", room, "login", req.Login, "name", name, "egress_id", info.EgressId)
	writeJSON(w, http.StatusOK, map[string]string{"egress_id": info.EgressId, "name": name})
}

// handleRecordingStop — POST /api/recording/stop. Само-заживление: активного
// egress нет (умер/сам завершился) — чистим метаданные и отвечаем
// {"stopped":false}, не падаем. Иначе: стоп, снимок участников, sidecar.
func (a *App) handleRecordingStop(w http.ResponseWriter, r *http.Request) {
	a.recMu.Lock()
	defer a.recMu.Unlock()

	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	// Кто жмёт стоп — из тела (как на старте): без этого «кто остановил» не
	// узнать, авторизации на запросах нет. Пустое тело — старые клиенты.
	var req struct {
		Login string `json:"login"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	active, err := a.activeRecording(ctx, room)
	if err != nil {
		slog.Error("recording: livekit unavailable", "op", "stop", "room", room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	if active == nil {
		delete(a.activeRec, room)
		a.clearRecordingMeta(ctx, room)
		slog.Info("recording was not active", "room", room, "login", req.Login)
		writeJSON(w, http.StatusOK, map[string]bool{"stopped": false})
		return
	}

	info, err := a.egress.StopEgress(ctx, &livekit.StopEgressRequest{EgressId: active.EgressId})
	if err != nil {
		slog.Error("recording: failed to stop", "egress_id", active.EgressId, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "не удалось остановить запись"})
		return
	}

	// Снимок участников на стопе (решение Q8) — «краткий список» в UI. Сам
	// egress ещё числится в комнате, пока не вышел, — отбрасываем его.
	var participants []string
	if resp, err := a.livekit.ListParticipants(ctx, &livekit.ListParticipantsRequest{Room: room}); err == nil {
		for _, p := range resp.Participants {
			if p.Kind == livekit.ParticipantInfo_EGRESS {
				continue
			}
			participants = append(participants, p.Identity)
		}
		sort.Strings(participants)
	}

	// Имя файла — своё с момента старта (activeRec): StopEgress может
	// вернуться до финализации, и FileResults тогда пуст. Результат egress —
	// фолбэк (запись, начатая до рестарта бэкенда).
	name := a.activeRec[room]
	if name == "" && len(info.FileResults) > 0 {
		name = filepath.Base(info.FileResults[0].Filename)
	}
	if name != "" && recNameRe.MatchString(name) {
		// Стартовый sidecar уже есть (см. handleRecordingStart) — дополняем его:
		// иначе перезапись потеряет флаг summary. Без sidecar (старые записи) —
		// собираем из результата egress и имени файла.
		path := filepath.Join(a.roomDir(room), strings.TrimSuffix(name, ".mp4")+".json")
		var meta recMeta
		if b, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(b, &meta)
		}
		fillRecMeta(&meta, name, time.Unix(0, info.StartedAt).Format(time.RFC3339))
		meta.StoppedAt = time.Now().Format(time.RFC3339)
		meta.Participants = participants
		if b, err := json.Marshal(meta); err == nil {
			if err := os.WriteFile(path, b, 0o644); err != nil {
				slog.Error("recording: sidecar write failed", "name", name, "err", err)
			}
		}
	}

	delete(a.activeRec, room)
	a.clearRecordingMeta(ctx, room)
	slog.Info("recording stopped", "room", room, "login", req.Login, "name", name, "participants", len(participants))
	writeJSON(w, http.StatusOK, map[string]bool{"stopped": true})
}

// handleRecordingSummary — POST /api/recording/summary. AI-кнопка: заказ сводки
// для идущей записи. Флаг пишется в sidecar (по нему воркер-секретарь найдёт
// файл после стопа), метаданные комнаты обновляются для UI. 409, если запись
// не идёт.
func (a *App) handleRecordingSummary(w http.ResponseWriter, r *http.Request) {
	a.recMu.Lock()
	defer a.recMu.Unlock()

	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	active, err := a.activeRecording(ctx, room)
	if err != nil {
		slog.Error("summary: livekit unavailable", "room", room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	if active == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "запись не идёт"})
		return
	}

	name := a.activeRec[room]
	if name == "" && len(active.FileResults) > 0 {
		name = filepath.Base(active.FileResults[0].Filename)
	}
	if !recNameRe.MatchString(name) {
		slog.Error("summary: could not determine recording file", "name", name)
		writeJSON(w, http.StatusConflict, map[string]string{"error": "не удалось определить файл записи"})
		return
	}

	path := filepath.Join(a.roomDir(room), strings.TrimSuffix(name, ".mp4")+".json")
	var meta recMeta
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &meta)
	}
	fillRecMeta(&meta, name, time.Unix(0, active.StartedAt).Format(time.RFC3339))
	meta.Summary = true
	if b, err := json.Marshal(meta); err == nil {
		if err := os.WriteFile(path, b, 0o644); err != nil {
			slog.Error("summary: sidecar write failed", "name", name, "err", err)
		}
	}

	// Метаданные: summary-вариант, но rec_started_at сохраняем — клиент живёт по
	// нему (длительность записи), терять нельзя.
	if _, err := a.livekit.UpdateRoomMetadata(ctx, &livekit.UpdateRoomMetadataRequest{
		Room: room, Metadata: recRoomMetaSummary(name, meta.StartedAt),
	}); err != nil {
		slog.Warn("summary: room metadata not updated", "room", room, "name", name, "err", err)
	}
	slog.Info("summary ordered", "name", name)
	writeJSON(w, http.StatusOK, map[string]bool{"summary": true})
}

// fillRecMeta — добивает пропуски в sidecar-метаданных из имени файла и времени
// egress, не трогая заполненное (например, флаг summary).
func fillRecMeta(meta *recMeta, name, startedAt string) {
	if meta.StartedBy == "" {
		meta.StartedBy, _ = parseRecName(name)
	}
	if meta.StartedAt == "" {
		meta.StartedAt = startedAt
	}
}

// clearRecordingMeta — гасит тег записи у всех клиентов комнаты.
func (a *App) clearRecordingMeta(ctx context.Context, room string) {
	if _, err := a.livekit.UpdateRoomMetadata(ctx, &livekit.UpdateRoomMetadataRequest{
		Room: room, Metadata: "",
	}); err != nil {
		slog.Warn("recording: failed to clear room metadata", "room", room, "err", err)
	}
}

// recFile — строка списка записей для фронта.
type recFile struct {
	Name         string   `json:"name"`
	StartedAt    string   `json:"started_at"` // RFC3339
	StoppedAt    string   `json:"stopped_at"` // RFC3339; пусто, если egress завершился сам
	StartedBy    string   `json:"started_by"`
	Participants []string `json:"participants"`
	Size         int64    `json:"size"`
	Summary      bool     `json:"summary"` // заказана AI-сводка
	// Состояние сводки — из {name}.summary.json, который пишет воркер-секретарь:
	// "" | transcribing | summarizing | done | error.
	AIStatus    string `json:"ai_status"`
	AIError     string `json:"ai_error"`
	SummaryText string `json:"summary_text"`
}

// dateRange — date_from/date_to из query: YYYY-MM-DD (весь день) или RFC3339
// (точный момент). date_to как дата — включительно по конец дня. Пустые
// значения — без границы.
func dateRange(q url.Values) (from, to time.Time, err error) {
	parse := func(v string) (time.Time, bool, error) {
		if v == "" {
			return time.Time{}, false, nil
		}
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t, false, nil
		}
		t, err := time.ParseInLocation("2006-01-02", v, time.Local)
		if err != nil {
			return time.Time{}, false, errors.New("ожидается YYYY-MM-DD или RFC3339")
		}
		return t, true, nil
	}
	from, _, err = parse(q.Get("date_from"))
	if err != nil {
		return
	}
	var toDay bool
	to, toDay, err = parse(q.Get("date_to"))
	if err != nil {
		return
	}
	if toDay {
		to = to.Add(24 * time.Hour) // дата — включительно по конец дня
	}
	if !from.IsZero() && !to.IsZero() && !from.Before(to) {
		err = errors.New("date_from позже date_to")
	}
	return
}

// filterByDate — отсекает записи вне [from, to). from/to нулевые — границы
// нет. Запись без распознаваемой даты (не бывает: started_at всегда
// RFC3339) при активном фильтре исключается.
func filterByDate(list []recFile, from, to time.Time) []recFile {
	out := list[:0]
	for _, item := range list {
		st, err := time.Parse(time.RFC3339, item.StartedAt)
		if err != nil {
			continue
		}
		if !from.IsZero() && st.Before(from) {
			continue
		}
		if !to.IsZero() && !st.Before(to) {
			continue
		}
		out = append(out, item)
	}
	return out
}

// handleRecordingsList — GET /api/recordings?room=. Файлы комнаты из volume;
// метаданные — из sidecar-json, при его отсутствии (запись оборвалась сама) —
// из имени файла. Идущую запись не показываем: mp4 ещё пишется.
// date_from/date_to — фильтр по дате звонка (YYYY-MM-DD или RFC3339),
// работает и в публичном API.
func (a *App) handleRecordingsList(w http.ResponseWriter, r *http.Request) {
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	from, to, err := dateRange(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидный date_from/date_to: " + err.Error()})
		return
	}
	ctx := r.Context()
	active, err := a.activeRecording(ctx, room)
	if err != nil {
		slog.Error("recordings: livekit unavailable", "room", room, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "livekit недоступен"})
		return
	}
	activeName := ""
	if active != nil && len(active.FileResults) > 0 {
		activeName = filepath.Base(active.FileResults[0].Filename)
	}

	dir := a.roomDir(room)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			writeJSON(w, http.StatusOK, []recFile{})
			return
		}
		slog.Error("recordings: failed to read dir", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "не удалось прочитать записи"})
		return
	}

	out := make([]recFile, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".mp4") || name == activeName {
			continue
		}
		st, err := e.Info()
		if err != nil {
			continue
		}
		item := recFile{Name: name, Size: st.Size(), Participants: []string{}}
		if b, err := os.ReadFile(filepath.Join(dir, strings.TrimSuffix(name, ".mp4")+".json")); err == nil {
			_ = json.Unmarshal(b, &item)
		} else {
			item.StartedBy, item.StartedAt = parseRecName(name)
		}
		// «Кто был» в UI — имена, а не логины: маппинг из конфига, как в /api/room.
		for i, login := range item.Participants {
			if emp := a.cfg.Employee(login); emp != nil {
				item.Participants[i] = emp.Name
			}
		}
		// Сводка — отдельный файл воркера (тот же каталог): он единственный
		// писатель, sidecar бэкенд не мутирует параллельно.
		if b, err := os.ReadFile(filepath.Join(dir, strings.TrimSuffix(name, ".mp4")+".summary.json")); err == nil {
			var s struct {
				Status  string `json:"status"`
				Error   string `json:"error"`
				Summary string `json:"summary"`
			}
			if json.Unmarshal(b, &s) == nil {
				item.AIStatus, item.AIError, item.SummaryText = s.Status, s.Error, s.Summary
			}
		}
		out = append(out, item)
	}
	out = filterByDate(out, from, to)
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	writeJSON(w, http.StatusOK, out)
}

// parseRecName — запасные дата и логин из имени файла, когда sidecar нет.
// "2025-06-11_14-30_ivanov-2.mp4" → ("ivanov", "2025-06-11T14:30:00+03:00").
func parseRecName(name string) (login, startedAt string) {
	base := strings.TrimSuffix(name, ".mp4")
	parts := strings.Split(base, "_")
	if len(parts) >= 3 {
		if t, err := time.ParseInLocation("2006-01-02_15-04", parts[0]+"_"+parts[1], time.Local); err == nil {
			startedAt = t.Format(time.RFC3339)
		}
		login = strings.Join(parts[2:], "_")
		login = strings.SplitN(login, "-", 2)[0]
	}
	return login, startedAt
}

// handleRecordingDownload — GET /api/recordings/{name}?room=. Имя валидируем
// строго: только имя файла, без путей.
func (a *App) handleRecordingDownload(w http.ResponseWriter, r *http.Request) {
	room, ok := a.roomFromRequest(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !recNameRe.MatchString(name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "невалидное имя файла"})
		return
	}
	path := filepath.Join(a.roomDir(room), name)
	if _, err := os.Stat(path); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "запись не найдена"})
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	http.ServeFile(w, r, path)
}
