# Деплой (Фаза 4)

Продакшн-развёртывание. В репозитории — один `docker-compose.yml` в корне,
который поднимает стек; **reverse proxy, TLS, домены и сертификаты —
ответственность того, кто деплоит**. Схема: браузер → ваш reverse proxy
(HTTPS) → backend / LiveKit (wss); медиа — UDP напрямую на livekit-server
или через TURN.

## Что нужно

- Linux-сервер с Docker и docker compose.
- Reverse proxy на самом хосте (Caddy, nginx, ...) — см. «Reverse proxy» ниже.
- Домен с A-записями на IP сервера (если нужен публичный HTTPS и TURN):

| Запись | Зачем |
|---|---|
| `hub.<домен>` | сайт, API, wss LiveKit — основной поддомен |
| `turn.<домен>` | сертификат TURN (отдельный TLS-листенер LiveKit) |

## Стек (docker-compose.yml в корне)

| Сервис | Роль | Сеть |
|---|---|---|
| `backend` | Go-бэкенд + статика фронта (собирается в образе), слушает `127.0.0.1:8090` | host network |
| `livekit-server` | сигналинг `7880`, медиа `7881/tcp` + `50000–50100/udp`, встроенный TURN | host network |
| `livekit-egress` | запись встреч в volume `recordings` | host network |
| `redis` (valkey) | очередь egress, `127.0.0.1:6379` | bridge |
| `secretary` | AI-сводки (STT/LLM, ключи в `.env`) | bridge |
| `recordings-init` | разовые права на volume записей | bridge |

Все сервисы слушают loopback: наружу (через файрвол) открываются только
медиа-порты LiveKit, HTTP/HTTPS отдаёт ваш reverse proxy.

## Reverse proxy (ваша ответственность)

Proxy должен работать на хосте или в контейнере с `network_mode: host` —
сервисы слушают `127.0.0.1`, bridge-контейнер до loopback не достучится.

Апстримы:

| Путь | Апстрим |
|---|---|
| `/rtc*` | `127.0.0.1:7880` (LiveKit wss) |
| всё остальное | `127.0.0.1:8090` (backend: сайт, `/api/*`) |

Пример Caddyfile (ваш файл, где угодно):

```caddy
hub.example.com {
	handle /rtc* {
		reverse_proxy 127.0.0.1:7880
	}
	reverse_proxy 127.0.0.1:8090
}
```

## Порты

### Открыть наружу

| Порт | Кто | Зачем |
|---|---|---|
| `80/tcp` | ваш proxy | HTTP-01 для сертификата и редирект на HTTPS — обязателен, без него нет TLS |
| `443/tcp` | ваш proxy | HTTPS: сайт, `/api/*`, wss `/rtc` |
| `50000–50100/udp` | livekit | WebRTC-медиа (голос), основной канал |
| `7881/tcp` | livekit | TCP-фолбэк медиа — полезен, если у клиентов режут UDP; можно не открывать |
| `3478/udp`, `5349/tcp` | livekit | TURN (встроенный), когда включён блок `turn:` в livekit.yaml |

### Держать закрытыми

| Порт | Кто | Почему закрыт |
|---|---|---|
| `8090/tcp` | backend | наружу не нужен: proxy ходит к нему по loopback |
| `7880/tcp` | livekit | сигналинг; клиенты ходят через wss на `hub.<домен>/rtc` (проксирует ваш proxy) |
| `6379/tcp` | redis | valkey (дроп-ин Redis), слушает только 127.0.0.1 (compose); не открывать |
| `5173/tcp` | vite | только dev (см. README, LAN-доступ) |

Пример ufw:

```bash
sudo ufw allow 80,443/tcp
sudo ufw allow 50000:50100/udp
sudo ufw allow 7881/tcp          # опционально
sudo ufw allow 3478/udp          # TURN
sudo ufw allow 5349/tcp          # TURN
```

## TLS и сертификаты

- **HTTPS**: выпускает ваш reverse proxy (Caddy — сам, по HTTP-01; nginx —
  certbot). HTTPS обязателен не для красоты: без secure context браузер не
  даст микрофон, а LiveKit SDK не подключится по wss.
- **TURN**: LiveKit нужен свой сертификат для `turn.<домен>`. Где взять — на
  твой выбор (ACME-клиент, копия из хранилища вашего proxy, свой CA). Готовые
  `.crt`/`.key` положи в `deploy/certs/` (каталог смонтирован в контейнер
  livekit как `/certs`, см. docker-compose.yml), раскомментируй блок `turn:` в
  `deploy/livekit.yaml`:

  ```yaml
  turn:
    enabled: true
    domain: turn.example.com
    cert_file: /certs/turn.example.com.crt
    key_file: /certs/turn.example.com.key
    tls_port: 5349
    udp_port: 3478
  ```

  и перезапусти стек (`bash deploy.sh` или `docker compose up -d`).

## Шаги

1. **DNS**: A-записи `hub.<домен>` и `turn.<домен>` → IP сервера, дождаться
   пропагации (`dig hub.<домен>`).
2. **Reverse proxy**: настроить на апстримы выше, открыть 80/443.
3. **Сотрудники**: логины/пароли в `config.yaml` (`./scripts/hashpass.sh 'пароль'`).
4. **Секреты**: при первом деплое `./deploy.sh` сам сменит dev-ключи
   livekit и сгенерирует `PUBLIC_API_KEY` в `.env`; STT/LLM ключи для
   секретаря впиши в `.env` вручную (шаблон `.env.example`).
5. **Деплой**: `bash deploy.sh` — соберёт фронт (в Docker-образе) и поднимет стек.
6. **TURN** (если есть удалённые участники): серт в `deploy/certs/`, блок
   `turn:` в `deploy/livekit.yaml`, `bash deploy.sh` ещё раз.

## Без домена (LAN)

Стек поднимается так же (`bash deploy.sh`), HTTPS отдаёт ваш proxy со
self-signed сертификатом (Caddy — `tls internal`; nginx — свой серт + `ssl_certificate`,
например из `openssl req -x509`). Браузер один раз попросит принять сертификат.
Без домена **нет TURN**: все участники должны быть в одной сети с сервером.

## Проверка после деплоя

- `https://hub.<домен>` — сайт открывается, сертификат валиден (замочек).
- Вход, запись встречи, сводка — работают.
- Публичный API: `curl -H "X-API-Key: $KEY" https://hub.<домен>/api/public/status`
  — см. [API.md](API.md).
- TURN из внешней сети: удалённый участник (не в вашей сети) слышит всех.
- Логи: `docker compose logs -f backend secretary`
  (ротация логов уже в compose: 10 MB × 3 файла).