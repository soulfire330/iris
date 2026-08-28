package main

import (
	"fmt"
	"net/url"
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

// TestFillRecMetaKeepsSummary — флаг summary не теряется, когда sidecar
// дополняется на стопе или при заказе сводки (fillRecMeta трогает только
// пустые поля).
func TestFillRecMetaKeepsSummary(t *testing.T) {
	meta := recMeta{Summary: true}
	fillRecMeta(&meta, "2025-06-11_14-30_ivanov.mp4", "2025-06-11T14:30:00+03:00")
	if !meta.Summary || meta.StartedBy != "ivanov" || meta.StartedAt == "" {
		t.Fatalf("sidecar: %+v", meta)
	}
}

// TestDateRange — date_from/date_to: дата (весь день включительно), RFC3339
// (точный момент), пустые границы и невалидное значение.
func TestDateRange(t *testing.T) {
	q := func(from, to string) url.Values {
		v := url.Values{}
		if from != "" {
			v.Set("date_from", from)
		}
		if to != "" {
			v.Set("date_to", to)
		}
		return v
	}

	from, to, err := dateRange(q("2025-06-11", "2025-06-11"))
	if err != nil {
		t.Fatalf("диапазон: %v", err)
	}
	if from.Format("2006-01-02") != "2025-06-11" || to.Format("2006-01-02") != "2025-06-12" {
		t.Fatalf("границы дня: from=%v to=%v", from, to)
	}

	if _, _, err := dateRange(q("2025-06-13", "2025-06-11")); err == nil {
		t.Fatal("перевёрнутый диапазон не отклонён")
	}
	if _, _, err := dateRange(q("не-дата", "")); err == nil {
		t.Fatal("мусор в date_from не отклонён")
	}

	// RFC3339 — точный момент без расширения дня.
	_, to, err = dateRange(q("", "2025-06-11T12:00:00+03:00"))
	if err != nil {
		t.Fatalf("rfc3339: %v", err)
	}
	if to.Format("15:04") != "12:00" {
		t.Fatalf("точный момент: %v", to)
	}
}

// TestFilterByDate — фильтр по started_at: в диапазоне, вне, без границ.
func TestFilterByDate(t *testing.T) {
	mk := func(day int) recFile {
		return recFile{
			Name:      fmt.Sprintf("2025-06-%02d_10-00_a.mp4", day),
			StartedAt: fmt.Sprintf("2025-06-%02dT10:00:00+03:00", day),
		}
	}
	list := []recFile{mk(10), mk(11), mk(12)}

	from, _, _ := dateRange(url.Values{"date_from": {"2025-06-11"}})
	_, to, _ := dateRange(url.Values{"date_to": {"2025-06-11"}})
	got := filterByDate(list, from, to)
	if len(got) != 1 || got[0].Name != mk(11).Name {
		t.Fatalf("в диапазоне: %+v", got)
	}

	if got := filterByDate(list, time.Time{}, time.Time{}); len(got) != 3 {
		t.Fatalf("без границ: %d", len(got))
	}
}
