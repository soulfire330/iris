import { useState } from 'react'
import { LoginPage } from '@/components/LoginPage'
import { RoomPage } from '@/components/RoomPage'
import { setAuthToken, type Session } from '@/lib/api'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  const onLogin = (s: Session) => {
    setAuthToken(s.token) // токен авторизует внутренний API (Bearer)
    setSession(s)
  }
  const onLeave = () => {
    setAuthToken('')
    setSession(null)
  }

  if (!session) return <LoginPage onLogin={onLogin} />
  return <RoomPage session={session} onLeave={onLeave} />
}
