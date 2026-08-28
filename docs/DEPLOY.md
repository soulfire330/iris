# Деплой (Фаза 4)

Продакшн-развёртывание: домен, TLS от Caddy, TURN для удалённых участников.
Схема: браузер → Caddy (HTTPS) → backend / LiveKit (wss); медиа — UDP напрямую
на livekit-server или через TURN.

## Что нужно

- Linux-сервер с Docker и docker compose (тестировалось на `./scripts/stack.sh up`).
- Домен с двумя A-записями на IP сервера:

| Запись | Зачем |
|---|---|
| `hub.<домен>` | сайт, API, wss LiveKit — основной поддомен |
| `turn.<домен>` | только для выпуска сертификата TURN (страница-заглушка в Caddyfile) |

## Порты

### Открыть наружу

| Порт | Кто | Зачем |
|---|---|---|
| `80/tcp` | Caddy | выпуск сертификата (HTTP-01) и редирект на HTTPS — **обязателен**, без него нет TLS |
| `443/tcp` | Caddy | HTTPS: сайт, `/api/*`, wss `/rtc` |
| `50000–60000/udp` | livekit | WebRTC-медиа (голос), основной канал |
| `7881/tcp` | livekit | TCP-фолбэк медиа — полезен, если у клиентов режут UDP; можно не открывать |
| `3478/udp`, `5349/tcp` | livekit | TURN (встроенный), когда раскомментирован блок `turn:` в livekit.yaml |

### Держать закрытыми

| Порт | Кто | Почему закрыт |
|---|---|---|
| `8090/tcp` | backend | наружу не нужен: Caddy ходит к нему по loopback (`127.0.0.1:8090`, caddy на host network) |
| `7880/tcp` | livekit | сигналинг; клиенты ходят через wss на `hub.<домен>/rtc` (проксирует Caddy) |
| `6379/tcp` | redis | valkey (дроп-ин Redis), уже слушает только 127.0.0.1 (compose); не открывать |
| `5173/tcp` | vite | только dev (см. README, LAN-доступ) |

Пример ufw:

```bash
sudo ufw allow 80,443/tcp
sudo ufw allow 50000:60000/udp
sudo ufw allow 7881/tcp          # опционально
sudo ufw allow 3478/udp          # TURN
sudo ufw allow 5349/tcp          # TURN
```

## TLS и сертификаты

- **HTTPS**: Caddy выпускает Let's Encrypt сам, по HTTP-01, при первом
  обращении к `https://hub.<домен>` — вручную ничего делать не нужно.
- **TURN**: Caddy дополнительно выпускает серт для `turn.<домен>`
  (заглушка в Caddyfile). LiveKit читает `cert_file`/`key_file` из volume
  `caddy_data` — блок `turn:` в `deploy/livekit.yaml` раскомментировать после
  первого выпуска серта и поправить пути под фактическое расположение
  (Caddy кладёт сертификаты в подкаталог issuer'а:
  `caddy/certificates/acme-v02.api.letsencrypt.org-directory/<домен>/`).
- HTTPS обязателен не для красоты: без secure context браузер не даст
  микрофон, а LiveKit SDK не подключится по wss.

## Шаги

1. **DNS**: A-записи `hub.<домен>` и `turn.<домен>` → IP сервера, дождаться
   пропагации (`dig hub.<домен>`).
2. **Домен в Caddy**: заменить `example.com` на свой в `deploy/Caddyfile`.
3. **Сотрудники**: логины/пароли в `config.yaml` (`./scripts/hashpass.sh 'пароль'`).
4. **Секреты**: при первом деплое `deploy/deploy.sh` сам сменит dev-ключи
   livekit и сгенерирует `PUBLIC_API_KEY` в `.env`; STT/LLM ключи для
   секретаря впиши в `.env` вручную (шаблон `.env.example`).
5. **Деплой**: `bash deploy/deploy.sh` — соберёт фронт (в Docker-образе) и поднимет стек.
6. **TURN** (если есть удалённые участники): раскомментировать блок `turn:` в
   `deploy/livekit.yaml`, поправить пути к серту, `bash deploy/deploy.sh` ещё раз.

## Без домена (LAN, self-signed)

Если домена нет, а встречаться нужно по локальной сети: `bash
 deploy/deploy-self-signed.sh` — Caddy раздаст HTTPS по IP сервера со
self-signed сертификатом (внутренний CA), браузер один раз попросит принять
сертификат. Без домена **нет TURN**: все участники должны быть в одной сети с
сервером.

## Проверка после деплоя

- `https://hub.<домен>` — сайт открывается, сертификат валиден (замочек).
- Вход, запись встречи, сводка — работают.
- Публичный API: `curl -H "X-API-Key: $KEY" https://hub.<домен>/api/public/status`
  — см. [API.md](API.md).
- TURN из внешней сети: удалённый участник (не в вашей сети) слышит всех.
- Логи: `docker compose -f deploy/docker-compose.yml logs -f backend secretary`
  (ротация логов уже в compose: 10 MB × 3 файла).
