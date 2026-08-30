package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestInviteStore — жизненный цикл инвайта: создание → чтение → отзыв,
// истечение по TTL, переживание рестарта (пересоздание стора с тем же файлом).
func TestInviteStore(t *testing.T) {
	s := newInviteStore(filepath.Join(t.TempDir(), "invites.json"))
	inv, err := s.create("office", "Петя", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(inv.Token) != 64 {
		t.Fatalf("token: ожидали 64 hex, получили %q", inv.Token)
	}

	if got, err := s.get(inv.Token); err != nil || got.Name != "Петя" {
		t.Fatalf("get живого: %+v %v", got, err)
	}
	if got := s.list("office"); len(got) != 1 {
		t.Fatalf("list: ожидали 1 инвайт, получили %d", len(got))
	}
	if got := s.list("other"); len(got) != 0 {
		t.Fatalf("list чужой комнаты: ожидали 0, получили %d", len(got))
	}
	if !s.revoke(inv.Token) {
		t.Fatal("revoke: ожидали true")
	}
	if _, err := s.get(inv.Token); err != errInviteNotFound {
		t.Fatalf("get после отзыва: ожидали errInviteNotFound, получили %v", err)
	}

	// Истечение: TTL в прошлом → get отвечает errInviteExpired, list не отдаёт.
	exp, _ := s.create("office", "Вася", -time.Second)
	if _, err := s.get(exp.Token); err != errInviteExpired {
		t.Fatalf("get истёкшего: ожидали errInviteExpired, получили %v", err)
	}
	if got := s.list("office"); len(got) != 0 {
		t.Fatalf("list после истечения: ожидали 0, получили %d", len(got))
	}

	// Рестарт: новый стор на том же файле видит инвайты (протухшие вычищены).
	live, _ := s.create("office", "Ира", time.Hour)
	s2 := newInviteStore(s.path)
	if got := s2.list("office"); len(got) != 1 || got[0].Token != live.Token {
		t.Fatalf("после перезагрузки: ожидали только живой инвайт Иры, получили %+v", got)
	}
}

// TestInviteStoreRollback — несохранённый инвайт не живёт в памяти: 500 на
// записи файла = инвайта нет (иначе он бы «ожил» после починки прав).
func TestInviteStoreRollback(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missing")
	s := newInviteStore(filepath.Join(dir, "invites.json")) // каталога нет — запись невозможна
	if _, err := s.create("office", "Петя", time.Hour); err == nil {
		t.Fatal("create: ожидали ошибку записи")
	}
	if got := s.list("office"); len(got) != 0 {
		t.Fatalf("после неудачной записи: ожидали 0 инвайтов, получили %d", len(got))
	}
}

// TestInviteHandlers — HTTP-поверхность: без токена — 401, гость — 403
// (создание), сотрудник создаёт; вход по ссылке выдаёт LiveKit-токен с ролью
// guest и многоразовый; отзыв убивает инвайт (join — 404); TTL вне границ и
// пустое имя — 400.
func TestInviteHandlers(t *testing.T) {
	cfg := &Config{Server: ServerConfig{
		LiveKit: LiveKitCfg{APIKey: "key", APISecret: "secret"},
		DataDir: t.TempDir(),
	}}
	cfg.Rooms = []RoomCfg{{Name: "office", Display: "Офис"}}
	app := &App{
		cfg:     cfg,
		invites: newInviteStore(filepath.Join(cfg.Server.DataDir, "invites.json")),
	}

	employee, err := app.LiveKitToken("office", "ivanov", "Иван", "s", "")
	if err != nil {
		t.Fatal(err)
	}
	guest, err := app.LiveKitToken("office", "inv-x", "Гость", "s", "guest")
	if err != nil {
		t.Fatal(err)
	}

	// do — запрос к хендлеру под опциональным Bearer-токеном.
	do := func(h http.HandlerFunc, method, path, token, body string) (*httptest.ResponseRecorder, *http.Request) {
		var r *http.Request
		if body != "" {
			r = httptest.NewRequest(method, path, strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
		} else {
			r = httptest.NewRequest(method, path, nil)
		}
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		// PathValue заполняет mux — в тесте ставим вручную для /api/invite/{token}.
		if rest, ok := strings.CutPrefix(r.URL.Path, "/api/invite/"); ok {
			r.SetPathValue("token", strings.SplitN(rest, "/", 2)[0])
		}
		w := httptest.NewRecorder()
		app.requireToken(h)(w, r)
		return w, r
	}

	// Доступ: без токена — 401, гость — 403.
	if w, _ := do(app.handleInviteCreate, http.MethodPost, "/api/invite?room=office", "", `{"name":"Петя","ttl_sec":3600}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("без токена: %d, want 401", w.Code)
	}
	if w, _ := do(app.handleInviteCreate, http.MethodPost, "/api/invite?room=office", guest, `{"name":"Петя","ttl_sec":3600}`); w.Code != http.StatusForbidden {
		t.Fatalf("гость создаёт инвайт: %d, want 403", w.Code)
	}
	// Валидация: пустое имя и TTL за потолком.
	if w, _ := do(app.handleInviteCreate, http.MethodPost, "/api/invite?room=office", employee, `{"name":"  ","ttl_sec":3600}`); w.Code != http.StatusBadRequest {
		t.Fatalf("пустое имя: %d, want 400", w.Code)
	}
	if w, _ := do(app.handleInviteCreate, http.MethodPost, "/api/invite?room=office", employee, `{"name":"Петя","ttl_sec":2592001}`); w.Code != http.StatusBadRequest {
		t.Fatalf("ttl за потолком: %d, want 400", w.Code)
	}

	// Создание сотрудником → токен в ответе, один в списке комнаты.
	w, _ := do(app.handleInviteCreate, http.MethodPost, "/api/invite?room=office", employee, `{"name":"Петя","ttl_sec":3600}`)
	if w.Code != http.StatusOK {
		t.Fatalf("создание: %d %s, want 200", w.Code, w.Body.String())
	}
	var created struct {
		Token string `json:"token"`
		Name  string `json:"name"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.Name != "Петя" {
		t.Fatalf("ответ создания: %s", w.Body.String())
	}

	if w, _ := do(app.handleInviteList, http.MethodGet, "/api/invites?room=office", employee, ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), created.Token) {
		t.Fatalf("список: %d %s", w.Code, w.Body.String())
	}
	// Грант токена — office: список чужой комнаты запрещён (403).

	// Вход: многоразовый, роль guest, identity inv-<token>.
	join := func() map[string]any {
		req := httptest.NewRequest(http.MethodPost, "/api/invite/"+created.Token+"/join", nil)
		req.SetPathValue("token", created.Token) // PathValue заполняет mux, в тесте — вручную
		rec := httptest.NewRecorder()
		app.handleInviteJoin(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("join: %d %s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		return resp
	}
	first := join()
	if first["role"] != "guest" || first["login"] != "inv-"+created.Token || first["name"] != "Петя" || first["token"] == "" {
		t.Fatalf("join-ответ: %v", first)
	}
	second := join() // повторный вход — тот же инвайт ещё жив (многоразовый)
	if second["token"] == "" {
		t.Fatal("второй join не выдал токен")
	}

	// Отзыв → join и info отвечают 404.
	if w, _ := do(app.handleInviteRevoke, http.MethodDelete, "/api/invite/"+created.Token+"?room=office", employee, ""); w.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", w.Code, w.Body.String())
	}
	req := httptest.NewRequest(http.MethodPost, "/api/invite/"+created.Token+"/join", nil)
	req.SetPathValue("token", created.Token)
	rec := httptest.NewRecorder()
	app.handleInviteJoin(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("join после отзыва: %d, want 404", rec.Code)
	}
	// Неизвестный токен в info — 404, мусор в пути — тоже.
	for _, path := range []string{"/api/invite/deadbeef", "/api/invite/не-токен"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.SetPathValue("token", strings.TrimPrefix(path, "/api/invite/"))
		rec := httptest.NewRecorder()
		app.handleInviteInfo(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("info %s: %d, want 404", path, rec.Code)
		}
	}
}
