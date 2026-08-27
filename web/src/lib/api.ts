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
