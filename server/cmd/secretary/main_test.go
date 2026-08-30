package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestSweepPipeline — старая запись без манифеста дорожек: STT получает mp4
// целиком с Bearer-ключом → LLM получает транскрипт и участников → на диске
// {имя}.summary.json со статусом done. Запись без флага не трогается.
func TestSweepPipeline(t *testing.T) {
	const audio = "FAKE-MP4-BYTES"
	sttCalls, llmCalls := 0, 0

	stt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sttCalls++
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("STT path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer stt-key" {
			t.Errorf("STT auth: %q", got)
		}
		if got := r.FormValue("response_format"); got != "verbose_json" {
			t.Errorf("STT response_format: %q", got)
		}
		if err := r.ParseMultipartForm(1 << 30); err != nil {
			t.Fatal(err)
		}
		f := r.MultipartForm.File["file"]
		if len(f) != 1 || f[0].Filename != "call.mp4" {
			t.Errorf("STT file: %+v", f)
		}
		fh, _ := f[0].Open()
		got, _ := io.ReadAll(fh)
		if string(got) != audio {
			t.Errorf("STT body: %q", got)
		}
		if got := r.FormValue("model"); got != "whisper-1" {
			t.Errorf("STT model: %q", got)
		}
		fmt.Fprint(w, `{"text":"обсуждали релиз","segments":[{"start":0,"end":5,"text":"обсуждали релиз"}]}`)
	}))
	defer stt.Close()

	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		llmCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("LLM path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer llm-key" {
			t.Errorf("LLM auth: %q", got)
		}
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Model != "gpt-test" || len(body.Messages) != 2 {
			t.Errorf("LLM body: %+v", body)
		}
		if !strings.Contains(body.Messages[0].Content, "Иван, Петя") {
			t.Errorf("LLM prompt без участников: %q", body.Messages[0].Content)
		}
		if body.Messages[1].Content != "обсуждали релиз" {
			t.Errorf("LLM transcript: %q", body.Messages[1].Content)
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Сводка: релиз в пятницу"}}]}`)
	}))
	defer llm.Close()

	dir := t.TempDir()
	old := time.Now().Add(-time.Hour)
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(filepath.Join(dir, name), old, old) // «дописанный» файл
	}
	write("call.json", `{"started_by":"ivanov","participants":["Иван","Петя"],"summary":true}`)
	write("call.mp4", audio)
	write("plain.json", `{"started_by":"petrov","summary":false}`)
	write("plain.mp4", "OTHER-AUDIO")

	if err := sweep(dir, cfg{base: stt.URL, key: "stt-key", model: "whisper-1"},
		cfg{base: llm.URL, key: "llm-key", model: "gpt-test"}, &http.Client{Timeout: time.Minute}); err != nil {
		t.Fatal(err)
	}

	if sttCalls != 1 || llmCalls != 1 {
		t.Fatalf("вызовов: STT %d, LLM %d — ожидал по одному", sttCalls, llmCalls)
	}
	s, err := readJSON[summary](filepath.Join(dir, "call.summary.json"))
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != "done" || s.Transcript != "обсуждали релиз" || s.Summary != "Сводка: релиз в пятницу" {
		t.Fatalf("сводка: %+v", s)
	}
	if _, err := os.Stat(filepath.Join(dir, "plain.summary.json")); err == nil {
		t.Fatal("запись без флага не должна разбираться")
	}
}

// TestSweepPipelineTracks — запись с манифестом дорожек (ADR-0005): каждая
// дорожка распознаётся отдельно, сегменты сдвигаются на старт дорожки и
// склеиваются хронологически с именами. Ретрай после LLM-ошибки берёт
// распознанные дорожки из кэша summary.json — STT не перегоняется.
func TestSweepPipelineTracks(t *testing.T) {
	sttCalls, llmCalls := 0, 0

	stt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sttCalls++
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Errorf("STT path: %s", r.URL.Path)
		}
		if got := r.FormValue("response_format"); got != "verbose_json" {
			t.Errorf("STT response_format: %q", got)
		}
		if err := r.ParseMultipartForm(1 << 30); err != nil {
			t.Fatal(err)
		}
		f := r.MultipartForm.File["file"]
		if len(f) != 1 {
			t.Fatalf("STT file: %+v", f)
		}
		fhh, _ := f[0].Open()
		audio, _ := io.ReadAll(fhh)
		switch f[0].Filename {
		case "call-ivanov.ogg":
			if string(audio) != "IVANOV-AUDIO" {
				t.Errorf("STT ivanov body: %q", audio)
			}
			fmt.Fprint(w, `{"text":"обсуждали релиз","segments":[{"start":0,"end":2,"text":"обсуждали релиз"}]}`)
		case "call-petrov.ogg":
			if string(audio) != "PETROV-AUDIO" {
				t.Errorf("STT petrov body: %q", audio)
			}
			fmt.Fprint(w, `{"text":"переносим на четверг","segments":[{"start":0,"end":3,"text":"переносим на четверг"}]}`)
		default:
			t.Errorf("неожиданный файл STT: %s", f[0].Filename)
		}
	}))
	defer stt.Close()

	wantTranscript := "[00:00] Иван: обсуждали релиз\n[00:05] Пётр: переносим на четверг"
	llm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		llmCalls++
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("LLM path: %s", r.URL.Path)
		}
		var body struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(body.Messages[0].Content, "ivanov, petrov") {
			t.Errorf("LLM prompt без участников: %q", body.Messages[0].Content)
		}
		if body.Messages[1].Content != wantTranscript {
			t.Errorf("LLM transcript:\n%q\nwant:\n%q", body.Messages[1].Content, wantTranscript)
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Сводка: релиз в четверг"}}]}`)
	}))
	defer llm.Close()

	dir := t.TempDir()
	old := time.Now().Add(-time.Hour)
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(filepath.Join(dir, name), old, old) // «дописанный» файл
	}
	write("call.json", `{"started_by":"ivanov","participants":["ivanov","petrov"],"summary":true,"started_at":"2026-08-28T14:20:00+03:00"}`)
	write("call.mp4", "MIX-AUDIO")
	write("call.tracks.json", `[
  {"file":"call-ivanov.ogg","login":"ivanov","name":"Иван","started_at":"2026-08-28T14:20:00+03:00"},
  {"file":"call-petrov.ogg","login":"petrov","name":"Пётр","started_at":"2026-08-28T14:20:05+03:00"}
]`)
	write("call-ivanov.ogg", "IVANOV-AUDIO")
	write("call-petrov.ogg", "PETROV-AUDIO")

	sttCfg := cfg{base: stt.URL, key: "stt-key", model: "whisper-1"}
	llmCfg := cfg{base: llm.URL, key: "llm-key", model: "gpt-test"}
	client := &http.Client{Timeout: time.Minute}
	if err := sweep(dir, sttCfg, llmCfg, client); err != nil {
		t.Fatal(err)
	}
	if sttCalls != 2 || llmCalls != 1 {
		t.Fatalf("вызовов: STT %d (хотел 2), LLM %d (хотел 1)", sttCalls, llmCalls)
	}
	sumPath := filepath.Join(dir, "call.summary.json")
	s, err := readJSON[summary](sumPath)
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != "done" || s.Transcript != wantTranscript || len(s.Tracks) != 2 {
		t.Fatalf("сводка: %+v", s)
	}

	// Ретрай: LLM упал после распознавания, файлы дорожек удалены — кэш в
	// summary.json должен пережить попытку, STT не вызывается повторно.
	s.Status, s.Error, s.Summary = "error", "llm timeout", ""
	if err := writeSummary(sumPath, s); err != nil {
		t.Fatal(err)
	}
	stale := time.Now().Add(-2 * time.Minute)
	_ = os.Chtimes(sumPath, stale, stale) // ошибка «отлежалась» — берём в работу
	_ = os.Remove(filepath.Join(dir, "call-ivanov.ogg"))
	_ = os.Remove(filepath.Join(dir, "call-petrov.ogg"))
	if err := sweep(dir, sttCfg, llmCfg, client); err != nil {
		t.Fatal(err)
	}
	if sttCalls != 2 || llmCalls != 2 {
		t.Fatalf("ретрай: STT %d (хотел 2 — из кэша), LLM %d (хотел 2)", sttCalls, llmCalls)
	}
	s, err = readJSON[summary](sumPath)
	if err != nil {
		t.Fatal(err)
	}
	if s.Status != "done" || s.Transcript != wantTranscript {
		t.Fatalf("сводка после ретрая: %+v", s)
	}
}

// TestSystemPromptFile — промпт берётся из LLM_PROMPT_FILE (читается каждый
// раз), файла нет или пуст — встроенный дефолт.
func TestSystemPromptFile(t *testing.T) {
	t.Setenv("LLM_PROMPT_FILE", "")
	if p := systemPrompt(); p != defaultPrompt {
		t.Fatal("без файла должен быть дефолт")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "prompt.md")
	if err := os.WriteFile(path, []byte("мой промпт"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LLM_PROMPT_FILE", path)
	if p := systemPrompt(); p != "мой промпт" {
		t.Fatalf("промпт из файла: %q", p)
	}
	t.Setenv("LLM_PROMPT_FILE", filepath.Join(dir, "нет-такого.md"))
	if p := systemPrompt(); p != defaultPrompt {
		t.Fatal("нет файла — дефолт")
	}
}

// TestSummaryStateRetry — после провала Attempts растёт, между попытками пауза,
// после maxAttempts файл оставляем в покое.
func TestSummaryStateRetry(t *testing.T) {
	dir := t.TempDir()
	sumPath := filepath.Join(dir, "x.summary.json")

	for _, tc := range []struct {
		json string
		done bool
	}{
		{`{"status":"done"}`, true},
		{`{"status":"error","attempts":3}`, true},
		{`{"status":"error","attempts":1}`, false}, // свежая ошибка → пауза
		{`{"status":"transcribing"}`, false},
	} {
		if err := os.WriteFile(sumPath, []byte(tc.json), 0o644); err != nil {
			t.Fatal(err)
		}
		done, retry := summaryState(sumPath)
		if done != tc.done {
			t.Errorf("%s: done=%v, want %v", tc.json, done, tc.done)
		}
		if tc.done && retry {
			t.Errorf("%s: retry при done", tc.json)
		}
	}

	// Ошибка старше retryAfter → берём в работу снова.
	old := time.Now().Add(-2 * time.Minute)
	if err := os.WriteFile(sumPath, []byte(`{"status":"error","attempts":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(sumPath, old, old)
	if done, retry := summaryState(sumPath); done || retry {
		t.Fatalf("старая ошибка должна браться в работу, done=%v retry=%v", done, retry)
	}
}
