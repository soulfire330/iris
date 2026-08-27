# План выполнения — «Виртуальный офис»

Лёгкий корпоративный голосовой хаб команды: одна постоянная комната, сотрудники в config.yaml, запись встреч по кнопке. Развёртывание — `docker compose up` на корпоративном сервере. AI-секретарь — отдельный эпик, в MVP не входит.

Глоссарий: [CONTEXT.md](../CONTEXT.md). Зафиксированные решения: [docs/adr/](adr/0001-config-instead-of-db.md), [adr/0002-egress-audio-recording.md](adr/0002-egress-audio-recording.md), [adr/0003-tls-turn-scheme.md](adr/0003-tls-turn-scheme.md).

---

## 1. Зафиксированные решения

| Область | Решение |
|---|---|
| Хранилище | Без СУБД: сотрудники в `config.yaml`, seed-аватары в `data/avatars.json`, записи — файлы в volume. Redis — только очередь Egress. (ADR-0001) |
| Авторизация | Свободный ввод login + password. bcrypt-хэш в конфиге. Лимит попыток: 5 за 5 минут на логин, в памяти бэкенда. |
| Токены | Единственный токен — LiveKit JWT (6 ч), выдаётся эндпоинтом `/api/login`. Отдельного app-JWT нет; фронт при 401 молча перелогинивается. |
| Роли | Нет. Все равны: любой запускает/останавливает запись. |
| Аватар | boringavatars, вариант Beam, палитра duotone. Случайный seed генерируется при первом входе, хранится в `data/avatars.json`. |
| Комната | Одна постоянная (`office`), закрывается при опустении (auto-dispose). Вход = авто-подключение. |
| Запись | Серверная, LiveKit Egress, audio-only RoomComposite → MP4 в volume (ADR-0002). Одна запись одновременно, кнопка глобальная. |
| TLS | Публичный домен, Let's Encrypt; Caddy терминирует HTTPS для веба и wss LiveKit (ADR-0003). |
| TURN | Встроенный в LiveKit, обязателен (есть удалённые участники). TURN/TLS на поддомене `turn.<домен>`, порты 3478/UDP + 5349/TCP. |
| Деплой | Docker compose на одном корпсервере. `livekit-server` — host network. |
| UI | Русский. React + Vite + TS + shadcn/ui + livekit-client + boringavatars. |

## 2. Архитектура

```
Браузер ──HTTPS──► Caddy ──► /api/* ──► backend (Go, :8080)
                         └──► wss /  ──► livekit-server (:7880)
                                          │  ├──► redis (:6379)  ← только очередь Egress
                                          │  └──► livekit-egress ─► data/recordings/*.mp4
                                          └──► TURN/TLS :5349, TURN/UDP :3478 (встроенный)
```

- `backend` раздаёт статику фронтенда (одна точка входа для Caddy).
- `livekit-server` на host network (доки LiveKit рекомендуют для производительности UDP).
- Volume `data/`: `avatars.json`, `recordings/` (общий для egress и backend).
- Конфиг читается при старте; изменение → `docker compose restart backend`.

### Сервисы compose

| Сервис | Образ | Роль |
|---|---|---|
| caddy | caddy | TLS, роутинг: веб/API → backend, wss → livekit, серт для TURN в файл |
| livekit-server | livekit/livekit-server | WebRTC-медиасервер + встроенный TURN |
| redis | redis:7-alpine | Очередь заданий Egress (это не «БД продукта») |
| livekit-egress | livekit/egress | Запись комнаты в MP4 |
| backend | сборка из `server/` | Авторизация, токены, Egress API, раздача файлов и статики |

## 3. Сеть и порты

| Порт | Кто | Куда |
|---|---|---|
| 80/443/tcp | Caddy | веб, wss |
| 7880/tcp | livekit | сигналинг (за Caddy) |
| 7881/tcp, 50000–60000/udp | livekit | WebRTC-медиа |
| 3478/udp, 5349/tcp | livekit | TURN (встроенный) |
| 8080/tcp | backend | только внутри compose |

Открыть снаружи: 443/tcp, 7881/tcp, 50000–60000/udp, 3478/udp, 5349/tcp.

## 4. Формат config.yaml

```yaml
server:
  livekit:
    host: localhost:7880
    api_key: <key>
    api_secret: <secret>
  room: office
  data_dir: /data

employees:
  - login: ivanov
    name: Иван Иванов
    password_hash: $2a$10$...   # генерится `go run ./cmd/hashpass`
```

## 5. API бэкенда

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/login` | `{login, password}` → `{token, room, name, avatar: {seed}}`. При первом входе создаёт seed аватара. |
| POST | `/api/recording/start` | Старт записи → `{egress_id}`. 409, если запись уже идёт. |
| POST | `/api/recording/stop` | Стоп активной записи. |
| GET | `/api/recordings` | Список файлов `{name, size, started_at, started_by}`. |
| GET | `/api/recordings/{name}` | Скачивание MP4. |
| GET | `/api/healthz` | Живучесть. |

Файлы записей: `recordings/2025-06-11_14-30_ivanov.mp4` (дата-время-логин стартовавшего).

## 6. Модель комнаты

- Участник: LiveKit identity = login; metadata = `{name, avatar_seed}` (JSON-строка, парсит фронт).
- Статусы в сетке: в сети / говорит (аудиоуровень LiveKit) / без звука (muted).
- Управление: Mute, Deafen (клиентский: заглушить весь входящий звук), переключатели браузерного DSP (echoCancellation, noiseSuppression, autoGainControl).
- Видео: вебкамера (вкл/выкл), расшар экрана (вкладка/окно/весь экран + звук). Авто-фокус: активная демонстрация занимает основную область, сетка — в стороне.

## 7. Фазы реализации

### Фаза 0 — Каркас и деплой (готово → «compose up поднимает стек»)
- [ ] Репо: `server/`, `web/`, `deploy/` (compose, конфиги LiveKit/Caddy, README-инструкция).
- [ ] compose: caddy, livekit-server (host network), redis, egress, backend-заглушка.
- [ ] livekit config: api keys, rtc-порты, redis, room config, TURN-блок.
- [ ] Конфиг-хелпер `cmd/hashpass`.

### Фаза 1 — Авторизация и комната (готово → «зашёл под своим логином и слышишь коллег»)
- [ ] `/api/login`: сверка bcrypt, лимит попыток, выдача LiveKit JWT (+metadata), генерация seed аватара.
- [ ] Фронт: форма логина, вход в комнату через livekit-client.
- [ ] Сетка участников: аватар (Beam duotone), имя, статусы (в сети/говорит/без звука).
- [ ] Mute / Deafen, настройки микрофона (выбор устройства, DSP-переключатели).

### Фаза 2 — Запись (готово → «нажал кнопку — через минуту в списке есть MP4»)
- [ ] `start`/`stop` через Egress API (audio-only, filepath в volume), статус активной записи в памяти бэкенда.
- [ ] Индикатор «идёт запись» в UI, кнопка start/stop.
- [ ] Список записей + скачивание, страница/модалка в фронте.
- [ ] Egress останавливается сам при опустении комнаты — проверить.

### Фаза 3 — Видео и экран (готово → «показ виден всем и занимает UI»)
- [ ] Вебкамера вкл/выкл.
- [ ] Расшар экрана (вкладка/окно/экран + системный звук).
- [ ] Авто-фокус на активную демонстрацию.

### Фаза 4 — Продакшн-развёртывание на корпсервере
- [ ] DNS: `hub.<домен>` + `turn.<домен>` → сервер.
- [ ] Серты Let's Encrypt (HTTP-01 для hub; TURN-серт — Caddy в общий volume certs, livekit читает `cert_file`/`key_file`).
- [ ] Файрвол: порты из таблицы §3.
- [ ] Проверка TURN из внешней сети (удалённый участник за NAT слышит всех).
- [ ] Инструкция: добавление сотрудника = правка config.yaml + `hashpass` + restart backend.

## 8. Открытые детали реализации (не решения)

- Выдача TURN-серта: два hostname по HTTP-01 (серты из certmagic-хранилища Caddy в файл для LiveKit) либо wildcard DNS-01 — выбрать на Фазе 4.
- Права на volume для egress (контейнер не root) — настроить в compose.
- `empty_timeout` комнаты — подобрать дефолт LiveKit.
- Удаление/ротация записей — не делаем, пока не попросят.

## 9. Отложено — Эпик 2 (AI-секретарь)

Саммари встреч, транскрипция (STT), хранение транскриптов, композит видео+экран в записи, роли, история с поиском.

## 10. Риски

| Риск | Митигация |
|---|---|
| Корпоративный файрвол режет TURN-порты | Рубильник: TURN/TLS на 443 со SNI-роутингом (ADR-0003) |
| Пароли закоммитят в репозиторий | bcrypt-хэши + README-предупреждение |
| Запись «одна на комнату» не устроит | Уже выбран egress — расширяется до композита без смены архитектуры |
