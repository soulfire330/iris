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
export interface RoomInfo {
  started_at_ms: number
  server_now_ms: number
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
  started_by: string
  participants: string[]
  size: number
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

export async function stopRecording(): Promise<{ stopped: boolean }> {
  const res = await fetch('/api/recording/stop', { method: 'POST' })
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
