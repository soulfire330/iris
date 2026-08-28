# Виртуальный офис

Корпоративный голосовой хаб команды: одна постоянная комната, сотрудники в `config.yaml`, запись встреч по кнопке, AI-сводки по кнопке. Go-бэкенд, React-фронт, LiveKit.

Документы: [PLAN.md](PLAN.md) (план выполнения), [CONTEXT.md](CONTEXT.md) (глоссарий), [docs/adr/](docs/adr/) (решения).

## Структура

```
deploy/            docker compose, конфиги LiveKit/Caddy/Egress
server/            Go-бэкенд (+ cmd/hashpass, cmd/secretary — воркер AI-сводок)
web/               React-фронт (Vite)
config.example.yaml шаблон конфига → скопируй в config.yaml (в .gitignore)
.env.example       шаблон секретов AI-сводок → скопируй в .env (в .gitignore)
data/              данные: avatars.json, recordings/ (в .gitignore)
```

## Быстрый старт (dev)

```bash
cp config.example.yaml config.yaml   # один раз, затем впиши сотрудников
cd web && bun install                # один раз
cd .. && bun dev                     # инфраструктура + бэкенд + фронт, http://localhost:5173
```

Сотрудники: внеси логин/имя в `config.yaml`, пароль сгенерируй `bun hashpass 'пароль'` и вставь хэш.

## Скрипты (из корня репозитория, `bun <скрипт>`)

| Скрипт | Что делает |
|---|---|
| `bun dev` | инфраструктура + бэкенд + vite (параллельно, Ctrl+C останавливает всё) |
| `bun infra:up` / `bun infra:down` | поднять/погасить redis + livekit-server + egress |
| `bun infra:logs` | логи livekit-server |
| `bun backend` | запустить Go-бэкенд (порт 8090) |
| `bun web:dev` | vite dev-сервер (5173; проксирует /api и /rtc на бэкенд/livekit) |
| `bun web:build` | продакшн-сборка фронта в web/dist |
| `bun hashpass 'пароль'` | bcrypt-хэш для config.yaml |
| `bun secretary` | воркер AI-сводок локально (нужен `.env` с STT/LLM) |
| `bun stack:up` / `bun stack:down` | полный compose-стек (Caddy + бэкенд в контейнере) — для прода |

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

Локально секретарь запускается вместе с `bun dev` (или отдельно: `bun secretary`; переменные — из `.env`). В compose секретарь поднимается сам с `env_file: ../.env`; без `.env` он ждёт настройки, остальной стек работает.

Системный промпт секретаря — редактируемый файл `deploy/secretary-prompt.md` (правки подхватываются без перезапуска воркера); участники встречи добавляются к промпту автоматически.

## Продакшн (Фаза 4)

1. DNS: `hub.<домен>` и `turn.<домен>` → сервер.
2. Заменить `example.com` в `deploy/Caddyfile`, сменить dev-ключи.
3. Раскомментировать блок `turn:` в `deploy/livekit.yaml`.
4. `bun stack:up` (или `docker compose -f deploy/docker-compose.yml up -d --build`)
5. Собрать фронт: `bun web:build` (кладутся в `web/dist`, бэкенд раздаёт).
6. Проверить TURN из внешней сети (удалённый участник слышит всех).
