# Виртуальный офис

Корпоративный голосовой хаб команды: одна постоянная комната, сотрудники в `config.yaml`, запись встреч по кнопке, AI-сводки по кнопке. Go-бэкенд, React-фронт, LiveKit.

Документы: [PLAN.md](PLAN.md) (план выполнения), [CONTEXT.md](CONTEXT.md) (глоссарий), [docs/API.md](docs/API.md) (публичный API), [docs/DEPLOY.md](docs/DEPLOY.md) (деплой), [docs/adr/](docs/adr/) (решения).

## Структура

```
deploy/            docker compose, конфиги LiveKit/Caddy/Egress
server/            Go-бэкенд (+ cmd/hashpass, cmd/secretary — воркер AI-сводок)
web/               React-фронт (Vite)
config.example.yaml шаблон конфига → скопируй в config.yaml (в .gitignore)
.env.example       шаблон секретов AI-сводок → скопируй в .env (в .gitignore)
data/              записи в dev (в проде — named volume recordings)
```

## Быстрый старт (dev)

```bash
cp config.example.yaml config.yaml   # один раз, затем впиши сотрудников
cd web && bun install                # один раз (bun нужен только для web/)
cd .. && ./scripts/dev.sh            # инфраструктура + бэкенд + фронт, http://localhost:5173
```

Сотрудники: внеси логин/имя в `config.yaml`, пароль сгенерируй `./scripts/hashpass.sh 'пароль'` и вставь хэш.

## Скрипты (из корня репозитория)

| Скрипт | Что делает |
|---|---|
| `./scripts/dev.sh` | инфраструктура + бэкенд + vite (параллельно, Ctrl+C останавливает всё) |
| `./scripts/infra.sh up` / `down` | поднять/погасить valkey + livekit-server + egress |
| `./scripts/infra.sh logs` | логи livekit-server |
| `./scripts/backend.sh` | запустить Go-бэкенд (порт 8090) |
| `./scripts/web.sh dev` | vite dev-сервер (5173; проксирует /api и /rtc на бэкенд/livekit) |
| `./scripts/web.sh build` | продакшн-сборка фронта в web/dist |
| `./scripts/hashpass.sh 'пароль'` | bcrypt-хэш для config.yaml |
| `./scripts/secretary.sh` | воркер AI-сводок локально (нужен `.env` с STT/LLM) |
| `./scripts/stack.sh up` / `down` | полный compose-стек (Caddy + бэкенд в контейнере) — для прода |

В dev микрофон работает на `localhost` (secure context), LiveKit доступен напрямую: `ws://localhost:7880`. Caddy не нужен до Фазы 4.

## Доступ с другого ПК (LAN)

Vite уже слушает `0.0.0.0:5173` по HTTPS (самоподписанный серт, генерируется `@vitejs/plugin-basic-ssl`). На другом компьютере:

1. Открой `https://<IP-этого ПК>:5173` (LAN-адрес, например `https://10.20.20.14:5173`).
2. Браузер спросит про самоподписанный серт — прими (beforeunload/«Дополнительно → продолжить»). Без HTTPS браузер не даст микрофон, само собой он и в строке `ws://localhost:7880` не поможет.
3. Протокол https даёт wss-прокси через vite — отдельно LiveKit настраивать не нужно.

Если за другим ПК не открывается — разреши порт в файрволе: `sudo ufw allow 5173/tcp`.

## AI-сводки

Кнопка AI рядом с записью появляется, только когда запись уже идёт, и заказывает сводку для неё (тег «секретарь» в шапке); пока записи нет — кнопки нет. После остановки записи воркер `secretary` (отдельный compose-сервис) распознаёт речь и присылает краткую сводку в таб «Сводки».

Настройка — `.env` (шаблон `.env.example`, секреты не в гите):

```env
STT_BASE_URL=https://…   # OpenAI-совместимый STT (Whisper), /v1/audio/transcriptions
STT_API_KEY=…
STT_MODEL=whisper-1
LLM_BASE_URL=https://…   # OpenAI-совместимый LLM, /v1/chat/completions
LLM_API_KEY=…
LLM_MODEL=…
```

Локально секретарь запускается вместе с `./scripts/dev.sh` (или отдельно: `./scripts/secretary.sh`; переменные — из `.env`). В compose секретарь поднимается сам с `env_file: ../.env`; без `.env` он ждёт настройки, остальной стек работает.

Системный промпт секретаря — редактируемый файл `deploy/secretary-prompt.md` (правки подхватываются без перезапуска воркера); участники встречи добавляются к промпту автоматически.

## Публичный API

Записи, сводки и статус комнаты для скриптов/ботов — `GET /api/public/*` под ключом `PUBLIC_API_KEY` (заголовок `X-API-Key`, задаётся в `.env`). Ключ не задан — API выключен (404). Фильтр по дате `date_from`/`date_to`. Документация: [docs/API.md](docs/API.md).

## Продакшн (Фаза 4)

Подробная инструкция (домены, порты, TLS, TURN, файрвол): [docs/DEPLOY.md](docs/DEPLOY.md).

Коротко: DNS `hub.<домен>` + `turn.<домен>` → сервер, домен в `deploy/Caddyfile`, сотрудники в `config.yaml`, ключи STT/LLM в `.env`, затем `bash deploy/deploy.sh` (фронт собирается в Docker-образе, сгенерирует секреты при первом запуске, поднимет стек). Нет домена — `bash deploy/deploy-self-signed.sh` (HTTPS по IP с self-signed сертификатом, только LAN). Снаружи открыты 80/443/tcp, 50000–50100/udp (+ TURN 3478/udp, 5349/tcp); 8090/7880/6379 наружу не выставляются.
