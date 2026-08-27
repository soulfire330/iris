export interface Session {
  token: string
  room: string
  name: string
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
