# Виртуальный офис

Корпоративный голосовой хаб команды: одна постоянная комната, сотрудники в `config.yaml`, запись встреч по кнопке. Go-бэкенд, React-фронт, LiveKit.

Документы: [PLAN.md](PLAN.md) (план выполнения), [CONTEXT.md](CONTEXT.md) (глоссарий), [docs/adr/](docs/adr/) (решения).

## Структура

```
deploy/     docker compose, конфиги LiveKit/Caddy/Egress
server/     Go-бэкенд (+ cmd/hashpass)
web/        React-фронт (Vite)
config.yaml сотрудники (логин, имя, bcrypt-хэш пароля)
data/       данные: avatars.json, recordings/ (в .gitignore)
```

## Быстрый старт (dev)

```bash
# 1. Секреты LiveKit (один раз)
openssl rand -hex 32            # подставить в deploy/livekit.yaml, deploy/egress.yaml, config.yaml

# 2. Сотрудник (один раз на человека)
go run ./server/cmd/hashpass 'пароль'   # вставить хэш в config.yaml

# 3. Инфраструктура (LiveKit + Redis + Egress)
docker compose -f deploy/docker-compose.yml up -d redis livekit-server livekit-egress

# 4. Бэкенд (из корня)
go run ./server

# 5. Фронт (из web/)
npm install && npm run dev     # http://localhost:5173
```

В dev микрофон работает на `localhost` (secure context), LiveKit доступен напрямую: `ws://localhost:7880`. Caddy не нужен до Фазы 4.

## Продакшн (Фаза 4)

1. DNS: `hub.<домен>` и `turn.<домен>` → сервер.
2. Заменить `example.com` в `deploy/Caddyfile`, сменить dev-ключи.
3. Раскомментировать блок `turn:` в `deploy/livekit.yaml`.
4. `docker compose -f deploy/docker-compose.yml up -d --build`
5. Собрать фронт: `cd web && npm run build` (кладутся в `web/dist`, бэкенд раздаёт).
6. Проверить TURN из внешней сети (удалённый участник слышит всех).
