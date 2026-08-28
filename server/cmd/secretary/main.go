// Секретарь — отдельный воркер AI-сводок. Сканирует каталог записей, находит
// mp4 с флагом summary в sidecar (AI-кнопка в UI), прогоняет аудио через
// OpenAI-совместимый STT, транскрипт — через OpenAI-совместимый LLM, и кладёт
// результат в {имя}.summary.json рядом с записью (его отдаёт бэкенд в
// /api/recordings). Секреты — переменные окружения (.env через env_file в
// compose); config.yaml воркеру не нужен.
//
// Эпик «AI-сводки»: кнопка AI = обычный egress + флаг summary в sidecar.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"office/internal/logging"
)

const (
	pollInterval = 10 * time.Second // частота сканирования каталога
	finalAge     = 30 * time.Second // mp4 «дописан»: mtime старше — egress закрыл файл
	maxAttempts  = 3                // попыток на запись, дальше — статус error
	retryAfter   = time.Minute      // пауза между попытками
)

// sidecar — поля записи, которые читает воркер (см. recordings.go recMeta).
type sidecar struct {
	StartedBy    string   `json:"started_by"`
	Participants []string `json:"participants"`
	Summary      bool     `json:"summary"`
}

// summary — {имя}.summary.json: состояние разбора и результат.
type summary struct {
	Status     string `json:"status"` // transcribing → summarizing → done; error после maxAttempts
	Attempts   int    `json:"attempts"`
	Error      string `json:"error"`
	Transcript string `json:"transcript,omitempty"`
	Summary    string `json:"summary,omitempty"`
}

func main() {
	logging.Setup()

	dir := flag.String("dir", "", "каталог записей (по умолчанию $RECORDINGS_DIR или /data/recordings)")
	flag.Parse()
	if *dir == "" {
		*dir = os.Getenv("RECORDINGS_DIR")
	}
	if *dir == "" {
		*dir = "/data/recordings"
	}

	stt := cfg{base: os.Getenv("STT_BASE_URL"), key: os.Getenv("STT_API_KEY"), model: envOr("STT_MODEL", "whisper-1")}
	llm := cfg{base: os.Getenv("LLM_BASE_URL"), key: os.Getenv("LLM_API_KEY"), model: os.Getenv("LLM_MODEL")}
	if stt.base == "" || llm.base == "" || llm.model == "" {
		// Не падаем в crash-loop: стек без AI должен подниматься. Настроил .env —
		// перезапусти сервис secretary.
		slog.Warn("secretary not configured: set STT_BASE_URL, LLM_BASE_URL, LLM_MODEL (see .env.example) — waiting")
		select {}
	}

	slog.Info("secretary: watching", "dir", *dir, "stt", stt.base, "llm", llm.base)
	client := &http.Client{Timeout: 30 * time.Minute} // STT длинной встречи — минуты
	for {
		if err := sweep(*dir, stt, llm, client); err != nil {
			slog.Error("secretary: sweep failed", "err", err)
		}
		time.Sleep(pollInterval)
	}
}

// sweep — один проход по каталогу: всё, что просит сводку и готово к разбору.
func sweep(dir string, stt, llm cfg, client *http.Client) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("каталог записей: %w", err)
	}
	mp4s := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".mp4") {
			continue
		}
		mp4s++
		info, err := e.Info()
		if err != nil {
			continue
		}
		base := strings.TrimSuffix(name, ".mp4")

		sc, err := readJSON[sidecar](filepath.Join(dir, base+".json"))
		if err != nil || !sc.Summary {
			continue // не AI-запись
		}

		sumPath := filepath.Join(dir, base+".summary.json")
		if done, retry := summaryState(sumPath); done || retry {
			continue
		}

		if time.Since(info.ModTime()) < finalAge {
			continue // egress ещё дописывает файл
		}
		if err := process(filepath.Join(dir, name), sumPath, sc, stt, llm, client); err != nil {
			slog.Error("secretary: failed to process", "file", name, "err", err)
		}
	}
	slog.Debug("secretary: sweep", "mp4", mp4s)
	return nil
}

// summaryState — стоит ли трогать запись: true — готово/ошибка окончательно,
// false — брать в работу. Для error: пауза retryAfter от последней попытки
// (mtime файла сводки).
func summaryState(sumPath string) (done, retry bool) {
	s, err := readJSON[summary](sumPath)
	if err != nil {
		return false, false // сводки ещё нет — брать
	}
	if s.Status == "done" {
		return true, false
	}
	if s.Status == "error" {
		if s.Attempts >= maxAttempts {
			return true, false // сдались
		}
		if fi, err := os.Stat(sumPath); err == nil && time.Since(fi.ModTime()) < retryAfter {
			return false, true // недавно падало — дать отлежаться
		}
	}
	return false, false
}

// process — цепочка STT → LLM → запись результата. Статусы пишутся в файл на
// каждом шаге, рестарт воркера не теряет прогресс. В логи — только метрики
// (длительности, размеры, символы), не содержимое встречи.
func process(mp4, sumPath string, sc sidecar, stt, llm cfg, client *http.Client) error {
	base := filepath.Base(mp4)
	mb := int64(0)
	if fi, err := os.Stat(mp4); err == nil {
		mb = fi.Size() >> 20
	}
	start := time.Now()
	slog.Info("secretary: processing", "file", base, "mb", mb)
	sum := summary{Status: "transcribing", Attempts: 1}
	if cur, err := readJSON[summary](sumPath); err == nil {
		sum.Attempts = cur.Attempts + 1
	}
	if err := writeSummary(sumPath, sum); err != nil {
		return err
	}

	text, err := transcribe(client, stt, mp4)
	if err != nil {
		return fail(sumPath, sum, err)
	}
	slog.Info("secretary: STT done", "file", base, "ms", time.Since(start).Milliseconds(), "chars", len(text))
	sum.Status, sum.Transcript = "summarizing", text
	if err := writeSummary(sumPath, sum); err != nil {
		return err
	}

	result, err := summarize(client, llm, sc, text)
	if err != nil {
		return fail(sumPath, sum, err)
	}
	slog.Info("secretary: LLM done", "file", base, "ms", time.Since(start).Milliseconds(), "chars", len(result))
	sum.Status, sum.Summary = "done", result
	if err := writeSummary(sumPath, sum); err != nil {
		return err
	}
	slog.Info("secretary: summary ready", "file", base, "total_ms", time.Since(start).Milliseconds())
	return nil
}

func fail(sumPath string, sum summary, err error) error {
	sum.Error = err.Error()
	sum.Status = "error" // Attempts < maxAttempts — вернёмся к файлу после retryAfter
	werr := writeSummary(sumPath, sum)
	slog.Warn("secretary: attempt failed", "file", filepath.Base(sumPath), "attempt", sum.Attempts, "max", maxAttempts, "err", err)
	return werr
}

const defaultPrompt = `Ты — секретарь команды в корпоративном голосовом хабе. По транскрипту встречи составь краткую сводку на русском языке.

Структура сводки:
- «Тема» — одна строка о чём встреча.
- «Главное» — решения и итоги.
- «Договорились» — кто и что делает, со сроками.
- «Открытые вопросы» — если остались.

Правила:
- Маркированные списки, ключевые слова выделяй жирным (**слово**).
- Не выдумывай: только то, что было в транскрипте; пустой раздел пропускай.
- Объём — 150–300 слов.`

// systemPrompt — промпт из файла LLM_PROMPT_FILE или встроенный дефолт.
// Файл читается каждый раз: редактирование без пересборки и рестарта.
func systemPrompt() string {
	path := os.Getenv("LLM_PROMPT_FILE")
	if path == "" {
		return defaultPrompt
	}
	b, err := os.ReadFile(path)
	if err != nil || len(bytes.TrimSpace(b)) == 0 {
		slog.Warn("secretary: prompt not read — using built-in default", "path", path, "err", err)
		return defaultPrompt
	}
	return string(b)
}

// cfg — OpenAI-совместимая точка: base + ключ + модель.
type cfg struct {
	base  string
	key   string
	model string
}

// endpoint — полный путь к OpenAI-совместимому методу. База может быть как
// https://host (добавим /v1), так и https://host/v1 — уже включает.
func (c cfg) endpoint(method string) string {
	base := strings.TrimSuffix(c.base, "/")
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	return base + method
}

// transcribe — POST {base}/v1/audio/transcriptions (multipart, как у OpenAI).
func transcribe(client *http.Client, c cfg, path string) (string, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(fw, f); err != nil {
		f.Close()
		return "", err
	}
	f.Close()
	if err := w.WriteField("model", c.model); err != nil {
		return "", err
	}
	w.Close()

	req, err := http.NewRequest(http.MethodPost, c.endpoint("/audio/transcriptions"), &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("STT %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Text == "" {
		return "", errors.New("STT вернул пустой транскрипт")
	}
	return out.Text, nil
}

// summarize — POST {base}/v1/chat/completions. Системный промпт — из файла
// LLM_PROMPT_FILE (deploy/secretary-prompt.md): читается при каждом разборе,
// правки подхватываются без перезапуска. Нет файла — встроенный дефолт.
func summarize(client *http.Client, c cfg, sc sidecar, text string) (string, error) {
	prompt := systemPrompt()
	if len(sc.Participants) > 0 {
		prompt += "\nУчастники встречи: " + strings.Join(sc.Participants, ", ") + "."
	}
	body, err := json.Marshal(map[string]any{
		"model": c.model,
		"messages": []map[string]string{
			{"role": "system", "content": prompt},
			{"role": "user", "content": text},
		},
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, c.endpoint("/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("LLM %s: %s", resp.Status, strings.TrimSpace(string(b)))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Choices) == 0 {
		return "", errors.New("LLM вернул пустой ответ")
	}
	return out.Choices[0].Message.Content, nil
}

// writeSummary — атомарная запись: rename, чтобы воркер и бэкенд никогда не
// увидели наполовину записанный файл.
func writeSummary(path string, s summary) error {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readJSON[T any](path string) (T, error) {
	var v T
	b, err := os.ReadFile(path)
	if err != nil {
		return v, err
	}
	err = json.Unmarshal(b, &v)
	return v, err
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
