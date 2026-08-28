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

// TestSweepPipeline — вся цепочка за один проход sweep: sidecar с флагом → STT
// получает mp4 целиком с Bearer-ключом → LLM получает транскрипт и участников
// → на диске {имя}.summary.json со статусом done. Запись без флага не трогается.
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
		fmt.Fprint(w, `{"text":"обсуждали релиз"}`)
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
