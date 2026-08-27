import { useState } from 'react'
import { LoginPage } from '@/components/LoginPage'
import { RoomPage } from '@/components/RoomPage'
import type { Session } from '@/lib/api'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  if (!session) return <LoginPage onLogin={setSession} />
  return <RoomPage session={session} onLeave={() => setSession(null)} />
}
