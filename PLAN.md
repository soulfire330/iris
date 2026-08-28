# План выполнения — «Виртуальный офис»

Лёгкий корпоративный голосовой хаб команды: одна постоянная комната, сотрудники в config.yaml, запись встреч по кнопке. Развёртывание — `docker compose up` на корпоративном сервере. AI-секретарь — эпик 2, в работе (§9).

Глоссарий: [CONTEXT.md](../CONTEXT.md). Зафиксированные решения: [docs/adr/](adr/0001-config-instead-of-db.md), [adr/0002-egress-audio-recording.md](adr/0002-egress-audio-recording.md), [adr/0003-tls-turn-scheme.md](adr/0003-tls-turn-scheme.md), [adr/0004-ai-summary-secretary.md](adr/0004-ai-summary-secretary.md).

---

## 1. Зафиксированные решения

| Область | Решение |
|---|---|
| Хранилище | Без СУБД: сотрудники в `config.yaml`, записи — файлы в volume. Valkey — только очередь Egress. (ADR-0001) |
| Авторизация | Свободный ввод login + password. bcrypt-хэш в конфиге. Лимит попыток: 5 за 5 минут на логин, в памяти бэкенда. |
| Токены | Единственный токен — LiveKit JWT (6 ч), выдаётся эндпоинтом `/api/login`. Отдельного app-JWT нет; он же авторизует внутренний API (заголовок `Authorization: Bearer`). При истечении (6 ч) — перезагрузка страницы и повторный вход. |
| Роли | Нет. Все равны: любой запускает/останавливает запись. |
| Аватар | boringavatars, вариант Beam, палитра duotone. Случайный seed на каждый вход (без хранилища), уходит в metadata токена — все клиенты видят одного зверя, при новом входе — нового. |
| Комната | Одна постоянная (`office`), закрывается при опустении (auto-dispose). Вход = авто-подключение. |
| Запись | Серверная, LiveKit Egress, audio-only RoomComposite → MP4 в volume (ADR-0002). Одна запись одновременно, кнопка глобальная. Статус клиентам — метаданные комнаты LiveKit (`roomMetadataChanged`); участники на стопе — sidecar-json у файла; источник правды — активные egress в LiveKit. Бип на старт/стоп. |
| AI-сводки | Кнопка AI видна при идущей записи и заказывает сводку: флаг `summary` в sidecar записи (ADR-0004). Отдельный воркер-секретарь (`server/cmd/secretary`) разбирает такие записи STT → LLM и кладёт `{имя}.summary.json`; секреты — `.env`, не config.yaml. Сводка — в табе «Сводки». |
| TLS | Публичный домен, Let's Encrypt; Caddy терминирует HTTPS для веба и wss LiveKit (ADR-0003). |
| TURN | Встроенный в LiveKit, обязателен (есть удалённые участники). TURN/TLS на поддомене `turn.<домен>`, порты 3478/UDP + 5349/TCP. |
| Деплой | Docker compose на одном корпсервере. `livekit-server` и `caddy` — host network. |
| UI | Русский. React + Vite + TS + shadcn/ui + livekit-client + boringavatars. |

## 2. Архитектура

```
Браузер ──HTTPS──► Caddy ──► /api/* ──► backend (Go, :8090)
                         └──► wss /  ──► livekit-server (:7880)
                                          │  ├──► valkey (:6379)  ← только очередь Egress
                                          │  └──► livekit-egress ─► data/recordings/*.mp4
                                          └──► TURN/TLS :5349, TURN/UDP :3478 (встроенный)

secretary ──► data/recordings/ (mp4 + sidecar с флагом summary) ──► STT/LLM API
                └─► пишет {имя}.summary.json ← backend отдаёт в /api/recordings
```

- `backend` раздаёт статику фронтенда (одна точка входа для Caddy).
- `secretary` (воркер AI-сводок, `server/cmd/secretary`): сканирует записи с флагом `summary`, STT → LLM, результат в `{имя}.summary.json` рядом с mp4. Секреты — `.env` (env_file), config.yaml не читает.
- `livekit-server` на host network (доки LiveKit рекомендуют для производительности UDP).
- Volume `recordings` (named docker volume, `office-recordings`): общий для egress, backend и secretary. Права чинит одноразовый init из образа самого egress (root'ом egress запускать нельзя — entrypoint поднимает pulseaudio, тот под root падает). В dev записи — `data/recordings/` на хосте (`deploy/docker-compose.dev.yml`, init делает каталог 777: туда пишут и egress, и хост-бэкенд).
- Конфиг читается при старте; изменение → `docker compose restart backend`.

### Сервисы compose

| Сервис | Образ | Роль |
|---|---|---|
| caddy | caddy | TLS, роутинг: веб/API → backend, wss → livekit, серт для TURN в файл |
| livekit-server | livekit/livekit-server | WebRTC-медиасервер + встроенный TURN |
| redis | valkey/valkey:7.2-alpine | Очередь заданий Egress — дроп-ин Redis 7.2 (это не «БД продукта») |
| livekit-egress | livekit/egress | Запись комнаты в MP4 |
| secretary | сборка из `server/` (тот же образ) | AI-сводки: разбор записей со `summary` (STT → LLM), `{имя}.summary.json` |
| backend | сборка из `server/` | Авторизация, токены, Egress API, раздача файлов и статики |

## 3. Сеть и порты

| Порт | Кто | Куда |
|---|---|---|
| 80/443/tcp | Caddy | веб, wss |
| 7880/tcp | livekit | сигналинг (за Caddy) |
| 7881/tcp, 50000–60000/udp | livekit | WebRTC-медиа |
| 3478/udp, 5349/tcp | livekit | TURN (встроенный) |
| 8090/tcp | backend | только внутри compose |

Открыть снаружи: 80/tcp (HTTP-01 для сертификата), 443/tcp, 7881/tcp, 50000–60000/udp, 3478/udp, 5349/tcp.

## 4. Формат config.yaml

```yaml
server:
  livekit:
    host: localhost:7880
    api_key: <key>
    api_secret: <secret>
  room: office
  data_dir: ./data
  web_dir: ./web-dist

employees:
  - login: ivanov
    name: Иван Иванов
    password_hash: $2a$10$...   # генерится `go run ./cmd/hashpass`
```

`config.yaml` в .gitignore — в репозитории лежит шаблон `config.example.yaml` (`cp config.example.yaml config.yaml`).

Секретарь (AI-сводки) настраивается не config.yaml, а `.env` (шаблон `.env.example`, подхватывается compose через env_file):

```env
STT_BASE_URL=…   # OpenAI-совместимый STT, /v1/audio/transcriptions
STT_API_KEY=…
STT_MODEL=whisper-1
LLM_BASE_URL=…   # OpenAI-совместимый LLM, /v1/chat/completions
LLM_API_KEY=…
LLM_MODEL=…
```

## 5. API бэкенда

Авторизация: все эндпоинты, кроме `/api/login`, `/api/healthz` и `/api/avatar/{login}`, требуют заголовок `Authorization: Bearer <LiveKit JWT>` (токен из ответа логина). Публичный API (`/api/public/*`) — отдельно, под ключом `X-API-Key`.

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/login` | `{login, password}` → `{token, room, name, avatar: {seed}}`. При первом входе создаёт seed аватара. |
| POST | `/api/recording/start` | Старт записи → `{egress_id}`. Тело `{login}`. 409, если запись уже идёт. |
| POST | `/api/recording/summary` | Заказ AI-сводки для идущей записи (кнопка AI). Флаг в sidecar + метаданные комнаты. 409, если записи нет. |
| POST | `/api/recording/stop` | Стоп активной записи. |
| GET | `/api/recordings` | Список файлов `{name, size, started_at, started_by, participants, summary, ai_status, ai_error, summary_text}`. |
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
- [x] `start`/`stop` через Egress API (audio-only, filepath в volume); одна запись, `ListEgress(active)` — источник правды, без памяти бэкенда.
- [x] Индикатор «идёт запись» в UI (тег в шапке), кнопка в панели звонка, бип на старт/стоп; статус — метаданные комнаты.
- [x] Список записей + скачивание в табе «Сводки» (дата, стартовавший, участники, размер); sidecar-json пишется на стопе.
- [ ] Egress останавливается сам при опустении комнаты — проверить на живом стеке.

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
- `empty_timeout` комнаты — подобрать дефолт LiveKit.
- Удаление/ротация записей — не делаем, пока не попросят.

## 9. Эпик 2 — AI-секретарь (в работе)

### Сделано
- [x] AI-кнопка в панели звонка: появляется при идущей записи и заказывает сводку для неё. Флаг `summary` — в sidecar записи (переживает стоп и рестарты), для UI — метаданные комнаты (ADR-0004).
- [x] Воркер-секретарь `server/cmd/secretary`: отдельный процесс/сервис, STT → LLM → `{имя}.summary.json`; статусы, ретраи (3 попытки), атомарная запись.
- [x] Сводка в табе «Сводки» у записи; секреты — `.env` (шаблон `.env.example`).

### Отложено
Транскрипт в UI, история с поиском, роли, композит видео+экран в записи.

## 10. Риски

| Риск | Митигация |
|---|---|
| Корпоративный файрвол режет TURN-порты | Рубильник: TURN/TLS на 443 со SNI-роутингом (ADR-0003) |
| Пароли и ключи закоммитят в репозиторий | `config.yaml` и `.env` в .gitignore; в гите — шаблоны `config.example.yaml`/`.env.example`; пароли — bcrypt |
| Запись «одна на комнату» не устроит | Уже выбран egress — расширяется до композита без смены архитектуры |
