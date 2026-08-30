export interface Session {
  token: string;
  room: string;
  room_display: string;
  name: string;
  login: string;
  role?: string;
  avatar_seed: string;
  token_ttl_sec: number;
}

// Комната для экрана входа: name — ID (имя комнаты LiveKit, им параметризуются
// все API-вызовы), display — подпись; остальное — живое состояние с сервера:
// participants полный (identity — логин, name — имя; счётчик людей и первые
// три аватара считаются из него), recording — запись. Аватар первых трёх
// участников приходит raw SVG-строкой (avatar) — /api/avatar экрану входа
// не нужен, сжатие — gzip на уровне HTTP.
export interface RoomOption {
  name: string;
  display: string;
  recording: boolean;
  participants: { identity: string; name: string; avatar?: string }[];
}

// authToken — LiveKit JWT сессии: им авторизуется внутренний API (Bearer).
// Ставится при логине (App.tsx), сбрасывается при выходе; /api/login и
// /api/healthz его не требуют.
let authToken = "";

export function setAuthToken(token: string) {
  authToken = token;
}

// req — fetch с понятной ошибкой сети: бэкенд упал/недоступен → «Нет связи с
// сервером» вместо английского «Failed to fetch». Ошибки HTTP (4xx/5xx) —
// как раньше, текст от сервера.
async function req(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
  } catch {
    throw new Error("Нет связи с сервером");
  }
}

// Список комнат публичен (экран входа — до авторизации), состояние живое:
// счётчики и запись обновляются при каждом опросе. Порядок — как в конфиге.
export async function fetchRooms(): Promise<RoomOption[]> {
  const res = await req("/api/rooms");
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as RoomOption[];
}

export async function login(login: string, password: string, room: string): Promise<Session> {
  const res = await req("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password, room }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as Session;
}

// --- Инвайт-ссылки (гостевой вход, см. docs): ---

// InviteInfo — ответ GET /api/invite/{token}: страница гостя до входа.
// identity — identity гостя в LiveKit (для проверки «вы уже в комнате»),
// avatar_seed стабилен на весь инвайт: превью = лицо в комнате.
export interface InviteInfo {
  token: string;
  identity: string;
  name: string;
  room: string;
  room_display: string;
  avatar_seed: string;
  expires_at: string;
  recording: boolean;
  participants: { identity: string; name: string }[];
}

// InviteMeta — строка в модалке «Пригласить»: имя гостя и срок жизни.
export interface InviteMeta {
  token: string;
  name: string;
  created_at: string;
  expires_at: string;
}

// Страница гостя опрашивает состояние комнаты, как экран входа — комнаты.
export async function fetchInviteInfo(token: string): Promise<InviteInfo> {
  const res = await req(`/api/invite/${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as InviteInfo;
}

// Вход по ссылке: LiveKit-токен гостя, сессия как после /api/login.
export async function joinInvite(token: string): Promise<Session> {
  const res = await req(`/api/invite/${encodeURIComponent(token)}/join`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as Session;
}

// Создание инвайта сотрудником (модалка «Пригласить»); ttl_sec — 60..2592000.
export async function createInvite(room: string, name: string, ttlSec: number): Promise<InviteMeta> {
  const res = await req(`/api/invite?room=${encodeURIComponent(room)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ttl_sec: ttlSec }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as InviteMeta;
}

// Живые инвайты комнаты — все, не только свои: чужой «забытый» можно отозвать.
export async function fetchInvites(room: string): Promise<InviteMeta[]> {
  const res = await req(`/api/invites?room=${encodeURIComponent(room)}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as InviteMeta[];
}

export async function revokeInvite(room: string, token: string): Promise<void> {
  const res = await req(`/api/invite/${encodeURIComponent(token)}?room=${encodeURIComponent(room)}`, {
    method: "DELETE",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
}

// Общий таймер комнаты: started_at_ms — момент входа первого участника
// (сервер берёт его из LiveKit), server_now_ms — часы сервера для
// выравнивания тика. 0 в started_at_ms — комната ещё пуста.
// participants — люди в комнате сейчас (для плиток-заглушек до коннекта).
// avatar — raw SVG из /api/room (снимок, ответ gzip'ится); после коннекта
// новые участники идут через LiveKit, их аватар — /api/avatar.
export interface RoomParticipant {
  identity: string;
  name: string;
  seed?: string;
  role?: string;
  avatar?: string;
}

export interface RoomInfo {
  started_at_ms: number;
  server_now_ms: number;
  num_participants: number;
  participants: RoomParticipant[];
}

export async function fetchRoomInfo(room: string): Promise<RoomInfo> {
  const res = await req(`/api/room?room=${encodeURIComponent(room)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as RoomInfo;
}

// Запись комнаты: серверная, через LiveKit Egress (ADR-0002). Статус для UI
// приходит не из этих вызовов, а из метаданных комнаты (roomMetadataChanged).

export interface RecordingFile {
  name: string;
  started_at: string;
  stopped_at: string; // пусто, если запись завершилась сама (комната опустела)
  started_by: string;
  participants: string[];
  size: number;
  summary: boolean;
  // Состояние сводки: "" | transcribing | summarizing | done | error.
  ai_status: string;
  ai_error: string;
  summary_text: string;
  // Размеченный транскрипт («[00:05] Имя: реплика»), пуст, пока сводка не готова.
  transcript?: string;
}

export async function startRecording(login: string, room: string): Promise<void> {
  const res = await req(`/api/recording/start?room=${encodeURIComponent(room)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
}

// Заказ AI-сводки для идущей записи (кнопка AI в панели звонка — видна только
// при идущей записи). Флаг пишет бэкенд в sidecar записи, воркер-секретарь
// разберёт её после стопа.
export async function enableRecordingSummary(room: string): Promise<void> {
  const res = await req(`/api/recording/summary?room=${encodeURIComponent(room)}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
}

export async function stopRecording(login: string, room: string): Promise<{ stopped: boolean }> {
  const res = await req(`/api/recording/stop?room=${encodeURIComponent(room)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as { stopped: boolean };
}

export async function fetchRecordings(room: string): Promise<RecordingFile[]> {
  const res = await req(`/api/recordings?room=${encodeURIComponent(room)}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as RecordingFile[];
}
