import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchRooms, login, type RoomOption, type Session } from '@/lib/api'
import { cn } from '@/lib/utils'

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Комнаты для селекта: список публичен и грузится до логина. Одна комната —
  // селект не показываем (выбор не нужен); список не загрузился — вход
  // заблокирован до повторной попытки (без комнаты токен не выдать).
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [roomsError, setRoomsError] = useState('')
  const [room, setRoom] = useState('')

  const loadRooms = useCallback(async () => {
    setRoomsError('')
    try {
      const list = await fetchRooms()
      setRooms(list)
      // Первая комната конфига — по умолчанию (порядок списка — порядок конфига).
      setRoom((cur) => cur || (list[0]?.name ?? ''))
    } catch {
      setRoomsError('Не удалось загрузить комнаты')
    }
  }, [])

  useEffect(() => {
    void loadRooms()
  }, [loadRooms])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await login(loginName.trim(), password, room))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Iris" className="h-7 w-7 rounded-md" />
            <h1 className="text-lg font-medium leading-none">Iris</h1>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{window.location.hostname}</span>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          {roomsError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{roomsError}</p>
              <Button type="button" variant="secondary" className="w-full" onClick={() => void loadRooms()}>
                Повторить
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="login" className="text-xs text-muted-foreground">
                  Логин
                </Label>
                <Input
                  id="login"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs text-muted-foreground">
                  Пароль
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {/* Селект комнаты — между полями и кнопкой: перед входом, но не первым действием. */}
              {rooms.length > 1 && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="room" className="text-xs text-muted-foreground">
                    Комната
                  </Label>
                  <div className="relative">   
                    <select
                      id="room"
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      className={cn(
                        'h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-9 pl-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      {rooms.map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.display}
                        </option>
                      ))}
                    </select>
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    >
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              )}
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={busy || roomsError !== '' || rooms.length === 0}
              >
                {busy ? 'Входим…' : (
                  <>
                    Войти в комнату
                    <span aria-hidden>→</span>
                  </>
                )}
              </Button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
