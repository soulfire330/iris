# Handoff: Iris — корпоративный голосовой хаб (одна комната)

## Overview

Iris — самостоятельно разворачиваемый голосовой «виртуальный офис» для одной команды: `docker compose up`, одна постоянная комната, список сотрудников в конфиге, без регистрации и без тяжёлой БД. Плюс AI-секретарь, который пишет встречу и присылает сводку после её окончания.

Этот пакет описывает **веб-интерфейс комнаты**: обычная вкладка браузера на весь вьюпорт, сетка участников, панель звонка, правая колонка со сводками и чатом, и отдельная раскладка для просмотра экрана.

## About the Design Files

Файлы в пакете — **дизайн-референсы, сделанные в HTML**. Это прототипы, показывающие внешний вид и поведение, а не продакшн-код для копирования. Задача — **воспроизвести эти экраны в целевой кодовой базе** (React + Tailwind), используя её существующие паттерны и библиотеки. Инлайновые стили в `Iris.dc.html` — следствие инструмента прототипирования; в реализации им соответствуют утилиты Tailwind, перечисленные ниже.

Целевой стек, заявленный командой: **Tailwind CSS** (раздел «Tailwind: тема и маппинг» ниже готов к копированию), shadcn/ui как база компонентов, Phosphor Icons как иконочный набор.

## Fidelity

**High-fidelity.** Цвета, типографика, отступы, радиусы, состояния и копирайт — финальные. Воспроизводить попиксельно, подставляя компоненты своей библиотеки там, где они совпадают по семантике (Button, Badge, Card, Tabs, ScrollArea).

Одно исключение: серые полосатые прямоугольники — это плейсхолдеры видеопотоков (вебка, шеринг экрана). В реализации на их месте `<video>`.

---

## Screens / Views

### 1. Комната (основной экран)

**Purpose:** человек открывает адрес и оказывается в комнате. Никакого лобби, выбора устройств и «join» — вход мгновенный, дальше он только говорит, слушает и иногда смотрит сводку.

**Layout**

- Приложение занимает 100% вьюпорта вкладки: `h-screen w-screen overflow-hidden`, фон `--background`. Никакой центрированной «карточки приложения» с полями по бокам.
- Вертикально: шапка (фикс. высота ≈ 47px: `py-3 px-4`) → рабочая область (`flex-1 min-h-0`).
- Рабочая область: CSS Grid `grid-cols-[1fr_300px]`. Левая колонка — сетка участников + панель звонка, правая — колонка секретаря и чата с левой границей `1px --border`.
- Левая колонка: `flex flex-col gap-4 p-6`; сетка участников `flex-1 min-h-0`, панель звонка прижата вниз (`mt-auto`).
- Сетка участников: `grid gap-3 place-content-center justify-items-center`, число колонок — от числа людей (см. «Геометрия плитки» ниже). Плитки **не растягиваются**: каждая держит 16:9, сетка центрируется в доступной области, свободное место остаётся полем вокруг сетки, а не пустотой внутри плиток.

**Геометрия плитки (важно — изменено)**

- Плитка всегда `aspect-[16/9]`. Это формат вебки и шаринга: поток встаёт в плитку без полей и без `object-cover`-обрезки.
- Плитка тем крупнее, чем меньше людей, но её ширина упирается в **половину ширины сцены**: `w-full max-w-[min(100%,50%_of_stage)]` — в реализации проще как `max-w-[540px]` от сцены ~1130px, или через `cqw`: обернуть сетку в `@container` и задать плитке `max-w-[50cqw]`.
- Число колонок по числу участников: 1 → 1 колонка · 2 → 2 · 3—4 → 2 (2×2) · 5—6 → 3 · 7—9 → 3 · 10+ → 4. Колонки считаются от числа людей, не от ширины; ширину ограничивает только кап и респонсив.
- Высота строк не задаётся — её диктует `aspect-ratio`. `auto-rows-fr` и `content-stretch` из предыдущей версии удалить.
- Респонсив поверх этого правила: < 1180px максимум 2 колонки, < 900px — 1.

**Components**

*Шапка комнаты*
- Слева: квадрат 22×22 с рамкой `1px --primary`, радиус 4px, внутри иконка `ph-broadcast` (fill) 12px цветом `--primary`.
- Название комнаты: 14px / 500 / `--foreground`. Текст: `Iris · общая комната`.
- Метрика: 11px моно, `--muted-foreground`. Текст: `6 в комнате · 01:42:07`.
- Справа два пилла (`rounded-full px-2 py-0.5`, рамка 1px, текст 10px моно uppercase, letter-spacing 0.08em):
  - Запись: рамка `--recording / 55%`, текст светлее на шаг, точка 6px `--recording` с пульсацией (opacity 1 → 0.3 → 1, 1.8s ease-in-out infinite).
  - Секретарь: рамка `--ai / 50%`, текст на шаг светлее, иконка `ph-sparkle` 12px.

*Плитка участника (аудио)*
- Фон `--card`, радиус 8px, тень/кромка `0 0 0 1px #3f424d` (`--border`), `aspect-[16/9] p-3`, `flex flex-col items-center justify-center gap-2`.
- Аватар: круг 60px, фон `--secondary` (`#3f424d` в dark), инициалы 18px / 500 / `--secondary-foreground`.
- Имя: 15px / 500. Роль под ним: 10px моно / `--muted-foreground` (`backend`, `frontend`, `devops`, `qa`, `product`).
- Состояние — одна строка под именем, максимум одна иконка 14px (см. «Состояния»).

*Плитка участника (камера включена)*
- Та же геометрия 16:9 и тот же кап по ширине. Плитка отдаёт себя видео: `p-0 overflow-hidden bg-[--muted]`, `<video className="absolute inset-0 h-full w-full object-cover">`.
- Внизу полоса на фоне `--background`: `px-3 py-2 flex items-center justify-between`, иконка `ph-video-camera` (fill) 13px `--primary` светлого шага, имя 12px / 500 с `truncate`, справа иконка микрофона 13px.
- Размер плитки не меняется — сетка не прыгает при включении камеры.

*Панель звонка*
- `mt-auto flex items-center justify-between gap-4 rounded-lg bg-[--card] p-3 shadow-[0_0_0_1px_#3f424d]`.
- Слева: «Микрофон» (primary, аутлайн с иконкой `ph-microphone` fill), затем icon-кнопки: `ph-headphones`, `ph-monitor-arrow-up`, `ph-video-camera`.
- Справа: моно-подпись 10px `docker · self-hosted` и кнопка «Выйти» (secondary, рамка `--destructive / 60%`, текст светлее, иконка `ph-sign-out`).
- Кнопки — аутлайн 1px на прозрачном, не залитые.

*Правая колонка: две вкладки*
- Табы во всю ширину: `flex border-b border-[--border]`, каждый таб `flex-1 py-3 text-xs`.
- Активный: текст `--foreground`, нижняя граница `1px --ai`, иконка `ph-sparkle` цветом `--ai`. Неактивный: текст `--muted-foreground`, граница прозрачная, ховер — на шаг светлее.
- «Чат» несёт бейдж непрочитанного: пилл min-w 16px / h 16px, фон `--accent`, текст `--accent-foreground`, 9px моно.
- Тело: `p-4 flex flex-col gap-4`.
  - Пояснение 12px `--muted-foreground`: «Секретарь пишет встречу и присылает сводку в чат комнаты после того, как вышел последний участник. По ходу разговора он молчит.»
  - Заголовок группы: 10px моно uppercase, letter-spacing 0.1em, `--muted-foreground` — «прошлые встречи».
  - Карточка сводки: `pl-3 border-l`, у свежей — `--ai / 35%`, у остальных `--border`. Внутри строка «Вчера, 10:00» (12px / 500) + «54 мин · 6» (10px моно, справа), под ней текст сводки 12px / 1.5.
  - Внизу `mt-auto` — ghost-кнопка на всю ширину «Все сводки» с иконкой `ph-file-text`.

**Копирайт (verbatim)** — брать из `Iris.dc.html`, он финальный.

---

### 2. Просмотр экрана

**Purpose:** кто-то показывает экран; остальные смотрят и продолжают говорить.

Это **не отдельный роут**, а другая раскладка той же комнаты. Переход анимируется как изменение сетки, не как навигация.

**Layout**

- Шапка та же, плюс пилл «экран Игоря Л.» (рамка `1px` тёмный шаг primary, текст светлый шаг primary, иконка `ph-monitor-arrow-up`).
- Рабочая область: `grid grid-cols-[1fr_208px]`.
- Слева: поток экрана `flex-1 rounded-lg overflow-hidden bg-[--muted]` + панель звонка снизу (та же, плюс ghost-кнопка «Во весь экран» с `ph-corners-out` и secondary «Свернуть показ» с `ph-x`).
- Поверх потока слева снизу — пилл говорящего: `absolute left-3 bottom-3 rounded-full bg-[--background] px-3 py-1.5 shadow-[0_0_0_1px_#3f424d]`, внутри эквалайзер из трёх полосок 3×10px `--primary` и текст «Игорь Л. говорит» 12px / 500.
- Справа — рельс участников: `flex flex-col gap-1.5 p-3`, строка = аватар 28px + имя 12px `truncate flex-1` + иконка состояния 13px. У показывающего экран строка обведена `0 0 0 1px --primary`. Внизу `mt-auto` — ghost-кнопка «Сводки и чат» с `ph-sidebar-simple`: колонка секретаря в этой раскладке уезжает за кнопку (Sheet справа).
- Одновременно только один поток. Второй показ забирает место у первого, без выбора «кого смотреть».

---

## Interactions & Behavior

- **Вход:** открытие адреса = вход в комнату. Микрофон по умолчанию выключен, звук включён.
- **Речь:** плитка говорящего получает `0 0 0 1px --speaking` + гало `0 0 0 5px --accent` и эквалайзер из трёх полосок. Полоски анимируются `scaleY` 0.3→1, 0.9s ease-in-out infinite, со сдвигом фаз. Порог: показывать после ~200ms речи, снимать через ~500ms тишины, чтобы не мигало.
- **Появление / уход:** плитка входит fade + scale 0.98→1 за 160ms ease-out; при выходе плитка исчезает и сетка пересобирается. Оффлайн-участников в интерфейсе нет вообще — конфиг не является интерфейсом.
- **Шеринг:** переход в раскладку 2 за 200ms (grid-template-columns + opacity). Выход — обратно.
- **Камера:** плитка меняет содержимое, не размер — 16:9 остаётся, поэтому сетка не прыгает.
- **Изменение числа людей:** число колонок и размер плиток пересчитываются с переходом 200ms (`grid-template-columns`, `max-width`), не мгновенным скачком.
- **Плохая связь:** янтарная иконка `ph-cell-signal-medium` + текст «плохая связь». **Без миллисекунд** — пинг не измеряем и не выдумываем.
- **Запись:** пульсирующая точка только в шапке. В сетке участников красного нет.
- **Неактивная вкладка:** звук идёт, состояние выносится в `document.title` и фавикон (точка записи, число людей в комнате).
- **Индикатора «печатает» нет** — сознательно, как и любой другой телеметрии внимания.
- **Ховеры и фокус:** ховер — тинт на шаг из ramp акцента; фокус — `outline: 2px solid --ring; outline-offset: 2px`. Дефолтного синего кольца быть не должно.
- **Респонсив:** < 1180px правая колонка уезжает в Sheet за кнопку, сетка в 2 колонки; < 900px — 1 колонка, панель звонка прилипает к низу; минимум 720px — ниже показываем только панель звонка и говорящего.
- **Скролла нет** нигде, кроме списка сводок и чата.

## State Management

Минимум состояния, никакой БД:

- `room`: `{ startedAt, recording: boolean }`
- `participants[]`: `{ id, name, initials, role, micOn, speaking, cameraOn, screenSharing, connectionPoor }` — живёт в памяти сервера, источник имён — конфиг (`users.yml`).
- `layout`: `'grid' | 'screen'` — производное от того, есть ли активный `screenSharing`.
- `panel`: `'summaries' | 'chat'` + `unreadCount`, в узких окнах ещё `panelOpen: boolean`.
- `summaries[]`: `{ id, startedAt, durationMin, participantCount, text }` — читается по HTTP, обновляется после встречи. **Realtime-саммари в MVP нет**: секретарь молчит во время разговора.
- Транспорт состояний участников — WebRTC + сигнальный WS; ничего из этого не требует персистентного хранилища.

## Tailwind: тема и маппинг

Токены объявляются один раз как CSS-переменные, Tailwind v4 подхватывает их через `@theme inline`. Радиус 0.5rem = 8px совпадает с базой дизайн-системы.

```css
/* app/globals.css */
@import "tailwindcss";

:root {
  --radius: 0.5rem;

  --background: #f3f5fe;
  --foreground: #292b31;
  --card: #f3f5fe;
  --card-foreground: #292b31;
  --popover: #e4e7f5;
  --popover-foreground: #292b31;
  --primary: #5d5294;
  --primary-foreground: #f5f4ff;
  --secondary: #e4e7f5;
  --secondary-foreground: #3f424d;
  --muted: #e4e7f5;
  --muted-foreground: #595d6c;
  --accent: #e7e5fe;
  --accent-foreground: #423a6a;
  --destructive: oklch(0.55 0.17 25);
  --destructive-foreground: #f3f5fe;
  --border: #cfd3e5;
  --input: #cfd3e5;
  --ring: #796cbf;

  /* Iris: голос комнаты */
  --speaking: #5d5294;
  --ai: oklch(0.50 0.08 195);
  --warn: oklch(0.62 0.13 75);
  --recording: oklch(0.55 0.17 25);
}

.dark {
  --background: #161826;
  --foreground: #e9e9ed;
  --card: #232532;
  --card-foreground: #e9e9ed;
  --popover: #292b31;
  --popover-foreground: #e9e9ed;
  --primary: #9184d9;
  --primary-foreground: #2b2741;
  --secondary: #292b31;
  --secondary-foreground: #cfd3e5;
  --muted: #292b31;
  --muted-foreground: #9397ab;
  --accent: #2b2741;
  --accent-foreground: #d2cefd;
  --destructive: oklch(0.62 0.16 25);
  --destructive-foreground: #f3f5fe;
  --border: #3f424d;
  --input: #3f424d;
  --ring: #b5abfc;

  --speaking: #9184d9;
  --ai: oklch(0.72 0.10 195);
  --warn: oklch(0.78 0.12 75);
  --recording: oklch(0.62 0.16 25);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-speaking: var(--speaking);
  --color-ai: var(--ai);
  --color-warn: var(--warn);
  --color-recording: var(--recording);

  --radius-lg: var(--radius);

  --font-sans: Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --animate-speak-1: speak1 0.9s ease-in-out infinite;
  --animate-speak-2: speak2 0.9s ease-in-out infinite;
  --animate-speak-3: speak3 0.9s ease-in-out infinite;
  --animate-rec: rec 1.8s ease-in-out infinite;
}

@keyframes speak1 { 0%,100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
@keyframes speak2 { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(0.45); } }
@keyframes speak3 { 0%,100% { transform: scaleY(0.55); } 50% { transform: scaleY(0.9); } }
@keyframes rec   { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
```

Готовые утилиты после этого: `bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `ring-ring`, `text-ai`, `text-warn`, `bg-speaking`, `animate-speak-1`, `animate-rec`, `font-mono`.

**Правила использования цвета** (важнее самих значений):

- Один акцент = присутствие. `--speaking` живёт в обводке и свечении, никогда как заливка большой площади.
- `--ai` живёт только в правой колонке секретаря: таб, левая линия свежей сводки, иконка `ph-sparkle`.
- `--warn` — только рядом со словом «плохая связь». `--recording` — только пилл в шапке и кнопка выхода.
- Мьют — нейтральный `--muted-foreground`, **не красный**: выключенный микрофон не авария.
- Никаких градиентов, стеклянных размытий и цветных заливок плиток. Ни чистого чёрного, ни чистого белого.
- Тени на тёмном фоне — кромка 1px плюс мягкая ambient-тень, не стопка теней:
  `sm: 0 0 0 1px #3f424d` · `md: 0 0 0 1px #595d6c, 0 6px 18px rgb(0 0 0 / 0.55)` · `lg: 0 0 0 1px #9397ab, 0 16px 40px rgb(0 0 0 / 0.65)`.

## Design Tokens

**Нейтрали (общая перцептивная шкала, OKLCH):** `#f3f5fe · #e4e7f5 · #cfd3e5 · #b2b6ca · #9397ab · #75798c · #595d6c · #3f424d · #292b31` (100→900).

**Акцент (blurple):** `#f5f4ff · #e7e5fe · #d2cefd · #b5abfc · #968ae0 · #796cbf · #5d5294 · #423a6a · #2b2741`. База в dark — `#9184d9`.

**AI (hue 195, та же шкала светлоты, хрома чуть ниже):** `oklch(0.93 0.03 195) · (0.87 0.05) · (0.80 0.08) · (0.76 0.09) · (0.72 0.10) · (0.62 0.09) · (0.50 0.08) · (0.38 0.06) · (0.28 0.04)`.

**Семантика:** warn `oklch(0.78 0.12 75)` / dark, `oklch(0.62 0.13 75)` / light. Recording `oklch(0.62 0.16 25)` / dark, `oklch(0.55 0.17 25)` / light.

**Отступы (плотная шкала 0.7×, округлять к ближайшей утилите Tailwind):** 2.8 · 5.6 · 8.4 · 11.2 · 16.8 · 22.4px → `0.5 · 1.5 · 2 · 3 · 4 · 6`.

**Радиусы:** 4 / 8 / 14px → `rounded-sm` / `rounded-lg` / `rounded-2xl`. Пиллы — `rounded-full`.

**Типографика:** Inter 400/500 — заголовки не тяжелее 500, иерархия делается размером и воздухом. JetBrains Mono — всё технически проверяемое: таймер, число людей, длительность, `docker · self-hosted`, размеры потока. Интерфейсные размеры: 10 / 11 / 12 / 13 / 14px; заголовки страницы 28 / 46px.

## Assets

- **Иконки:** [Phosphor Icons](https://phosphoricons.com) — `broadcast`, `microphone`, `microphone-slash`, `headphones`, `monitor-arrow-up`, `video-camera`, `cell-signal-medium`, `sparkle`, `chat-teardrop-text`, `file-text`, `sign-out`, `corners-out`, `sidebar-simple`, `x`, `pencil-simple-line` (не используется — см. запрет на «печатает»). Ставить `@phosphor-icons/react`.
- **Шрифты:** Inter и JetBrains Mono (Google Fonts / `next/font`).
- **Изображений нет.** Полосатые серые прямоугольники в прототипе — плейсхолдеры `<video>`; аватары — инициалы, фото только если их положили в конфиг.

## Files

- `Iris.dc.html` — полный дизайн-док: раздел 01 «комната» (в окне браузера, со схемой «размер плитки от числа людей» под макетом), 02 «просмотр экрана», 03 «состояния», 04 «палитра», 05 «токены», плюс списки «делать / не делать». **Главный референс.**
- `browser-window.jsx` — только хром браузера вокруг мокапа, к продукту не относится, реализовывать не нужно.
- `nocturne/styles.css` — токен-шит и классы базовой дизайн-системы (Nocturne), из которого взяты значения. Полезен как источник истины по ramp'ам и тенями.
- `nocturne/readme.md` — правила самой дизайн-системы: аутлайн-кнопки, акцент линией и свечением, плотная шкала, запреты.

Примечание: `Iris.dc.html` ссылается на стили дизайн-системы по пути `_ds/nocturne-…/styles.css`. Если открывать файл прямо из этой папки, поправьте путь на `nocturne/styles.css` — либо просто читайте документ как спецификацию: все значения дублированы в этом README.

## Не делать (перенести в реализацию как есть)

- Экраны онбординга, туры, пустые состояния «начните работу», лобби с выбором устройств.
- Список всех сотрудников в интерфейсе: конфиг — не интерфейс, в комнате только те, кто в ней.
- Индикаторы «печатает» / «прочитано» и прочая телеметрия внимания.
- Аватарки-эмодзи и иллюстрации присутствия.
- Модалки поверх активного звонка: подтверждения живут в Popover у самой кнопки.
- Числа, которых у нас нет (пинг в мс).
