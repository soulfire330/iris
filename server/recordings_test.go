package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRecordingName(t *testing.T) {
	dir := t.TempDir()
	ts := time.Date(2025, 6, 11, 14, 30, 0, 0, time.Local)

	first := recordingName(dir, ts, "ivanov")
	if first != "2025-06-11_14-30_ivanov.mp4" {
		t.Fatalf("первое имя: %q", first)
	}
	// Занятое имя — суффикс, свободное пропускается (проверка os.Stat).
	if err := os.WriteFile(filepath.Join(dir, first), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if second := recordingName(dir, ts, "ivanov"); second != "2025-06-11_14-30_ivanov-2.mp4" {
		t.Fatalf("коллизия: %q", second)
	}
}

func TestParseRecName(t *testing.T) {
	login, startedAt := parseRecName("2025-06-11_14-30_ivanov-2.mp4")
	if login != "ivanov" {
		t.Fatalf("login: %q", login)
	}
	if want := "2025-06-11T14:30:00" + time.Now().Format("-07:00"); startedAt[:16] != want[:16] {
		t.Fatalf("started_at: %q", startedAt)
	}
}
