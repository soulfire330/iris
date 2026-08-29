# Публичный API

Внешний доступ к записям и сводкам для скриптов, ботов и дашбордов. Внутренние
эндпоинты (`/api/...`) не изменились, кроме авторизации: они требуют заголовок
`Authorization: Bearer <LiveKit JWT>` (токен из ответа `/api/login`);
публичными остаются `login`, `healthz`, `rooms` и аватары.

Все эндпоинты с данными комнаты требуют обязательный параметр `?room=` (имя
комнаты из конфига); публичный список комнат — `GET /api/rooms` (без ключа,
порядок как в конфиге: `[{name, display}, ...]`).

## Авторизация

Заголовок `X-API-Key` на каждый запрос. Ключ — переменная `PUBLIC_API_KEY` в
`.env` (сгенерировать: `openssl rand -hex 32`), после смены — `docker compose
restart backend`.

Ключ **не задан** — все эндпоинты `/api/public/*` отвечают 404, как будто их
нет. Неверный ключ — тоже 404 (не светим существование API). Ключ не
попадает в логи: access-лог пишет только метод, путь и статус.

## Эндпоинты

| Метод и путь | Что возвращает |
|---|---|
| `GET /api/public/recordings?room=` | список записей комнаты со сводками, с фильтром по дате |
| `GET /api/public/recordings/{name}?room=` | mp4-файл записи (Content-Disposition: attachment) |
| `GET /api/public/status?room=` | снимок: комната, участники, запись, сводка |

### Список записей

`GET /api/public/recordings?room=office&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`

Комната обязательна: `room` вне конфига — `400`. Записи хранятся в подкаталоге
комнаты (`recordings/<room>/`).

Фильтр по дате звонка (`started_at`), обе границы опциональны:

- `YYYY-MM-DD` — весь день; `date_to` **включительно** по конец дня;
- RFC3339 (`2025-06-11T10:30:00+03:00`) — точный момент;
- невалидное значение или `date_from` позже `date_to` — `400`.

Ответ — массив, отсортированный по имени (дате) по убыванию:

```json
[
  {
    "name": "2025-06-11_14-30_ivanov.mp4",
    "started_at": "2025-06-11T14:30:00+03:00",
    "stopped_at": "2025-06-11T15:12:00+03:00",
    "started_by": "ivanov",
    "participants": ["Иван", "Пётр"],
    "size": 48201337,
    "summary": true,
    "ai_status": "done",
    "ai_error": "",
    "summary_text": "**Тема:** ..."
  }
]
```

| Поле | Значение |
|---|---|
| `name` | имя файла, оно же — для скачивания |
| `started_at` / `stopped_at` | даты звонка, RFC3339; `stopped_at` пуст, если запись оборвалась сама (комната опустела) |
| `started_by` | логин сотрудника, начавшего запись |
| `participants` | логины присутствовавших на стопе (пустой при самообрыве) |
| `size` | размер mp4 в байтах |
| `summary` | заказана ли AI-сводка |
| `ai_status` | `""` \| `transcribing` \| `summarizing` \| `done` \| `error` |
| `ai_error` | текст ошибки разбора (только при `ai_status: error`) |
| `summary_text` | текст сводки (пусто, пока не готова) |

Идущая запись в списке не показывается (mp4 ещё пишется).

### Скачивание записи

`GET /api/public/recordings/2025-06-11_14-30_ivanov.mp4?room=office` — mp4 в
Content-Disposition. Несуществующее имя — `404`.

### Статус комнаты

`GET /api/public/status?room=office`

```json
{
  "room_active": true,
  "num_participants": 3,
  "recording": true,
  "recording_name": "2025-06-11_14-30_ivanov.mp4",
  "summary_ordered": true
}
```

| Поле | Значение |
|---|---|
| `room_active` | комната существует. Нюанс: живёт ещё 2 минуты после выхода последнего участника (`empty_timeout` в livekit.yaml) — «идёт ли встреча прямо сейчас» смотри по `num_participants` |
| `num_participants` | людей в комнате сейчас (без egress-бота записи) |
| `recording` | идёт ли запись |
| `recording_name` | имя текущей записи (при идущей записи) |
| `summary_ordered` | заказана ли сводка для текущей записи |

## Ошибки

| Код | Когда |
|---|---|
| `404` | ключ не задан/неверный; запись не найдена |
| `400` | невалидный `date_from`/`date_to`; `room` вне конфига или отсутствует |
| `502` | livekit недоступен |

## Примеры

```bash
KEY=$(grep PUBLIC_API_KEY .env | cut -d= -f2)

# Все записи комнаты office
curl -H "X-API-Key: $KEY" "https://hub.example.com/api/public/recordings?room=office"

# Записи за день
curl -H "X-API-Key: $KEY" "https://hub.example.com/api/public/recordings?room=office&date_from=2025-06-11&date_to=2025-06-11"

# Скачать запись
curl -H "X-API-Key: $KEY" -OJ "https://hub.example.com/api/public/recordings/2025-06-11_14-30_ivanov.mp4?room=office"

# Статус
curl -H "X-API-Key: $KEY" "https://hub.example.com/api/public/status?room=office"
```
