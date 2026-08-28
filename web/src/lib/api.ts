export interface Session {
  token: string
  room: string
  name: string
  login: string
  role?: string
  avatar_seed: string
  token_ttl_sec: number
}

export async function login(login: string, password: string): Promise<Session> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
  return data as Session
}

// Общий таймер комнаты: started_at_ms — момент входа первого участника
// (сервер берёт его из LiveKit), server_now_ms — часы сервера для
// выравнивания тика. 0 в started_at_ms — комната ещё пуста.
// participants — люди в комнате сейчас (для плиток-заглушек до коннекта).
export interface RoomParticipant {
  identity: string
  name: string
  seed?: string
  role?: string
}

export interface RoomInfo {
  started_at_ms: number
  server_now_ms: number
  num_participants: number
  participants: RoomParticipant[]
}

export async function fetchRoomInfo(): Promise<RoomInfo> {
  const res = await fetch('/api/room')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
  return data as RoomInfo
}

// Запись комнаты: серверная, через LiveKit Egress (ADR-0002). Статус для UI
// приходит не из этих вызовов, а из метаданных комнаты (roomMetadataChanged).

export interface RecordingFile {
  name: string
  started_at: string
  stopped_at: string // пусто, если запись завершилась сама (комната опустела)
  started_by: string
  participants: string[]
  size: number
  summary: boolean
  // Состояние сводки: "" | transcribing | summarizing | done | error.
  ai_status: string
  ai_error: string
  summary_text: string
}

export async function startRecording(login: string): Promise<void> {
  const res = await fetch('/api/recording/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
}

// Заказ AI-сводки для идущей записи (кнопка AI в панели звонка — видна только
// при идущей записи). Флаг пишет бэкенд в sidecar записи, воркер-секретарь
// разберёт её после стопа.
export async function enableRecordingSummary(): Promise<void> {
  const res = await fetch('/api/recording/summary', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
}

export async function stopRecording(login: string): Promise<{ stopped: boolean }> {
  const res = await fetch('/api/recording/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
  return data as { stopped: boolean }
}

export async function fetchRecordings(): Promise<RecordingFile[]> {
  const res = await fetch('/api/recordings')
  const data = await res.json().catch(() => ([]))
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`)
  return data as RecordingFile[]
}
