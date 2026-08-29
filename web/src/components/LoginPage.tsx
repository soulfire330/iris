import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CaretDown,
  Microphone,
  MicrophoneSlash,
  Plugs,
  VideoCamera,
  VideoCameraSlash,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchRooms, login, type RoomOption, type Session } from '@/lib/api'
import { avatarUrl } from '@/lib/avatars'
import { cn } from '@/lib/utils'

// Намерение «с чем войти»: микрофон/камера включаются в комнате после
// коннекта (RoomPage читает те же ключи). Логин — предзаполнение поля.
const LS_LOGIN = 'iris.login.login'
const LS_MIC = 'iris.login.mic'
const LS_CAM = 'iris.login.cam'

// Русская плюрализация: 1 комната, 2 комнаты, 5 комнат, 21 комната.
function roomsPlural(n: number): string {
  const m = n % 10
  const h = n % 100
  if (m === 1 && h !== 11) return 'комната'
  if (m >= 2 && m <= 4 && (h < 12 || h > 14)) return 'комнаты'
  return 'комнат'
}

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [loginName, setLoginName] = useState(() => localStorage.getItem(LS_LOGIN) ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  // Сервер не ответил на опрос комнат — «сервер не отвечает, пробуем снова».
  const [offline, setOffline] = useState(false)
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [room, setRoom] = useState('')
  // Развёрнут ли полный список комнат (видно три, дальше — «Ещё N комнат»).
  const [expanded, setExpanded] = useState(false)
  // Вход отклонён (401) — красная рамка пароля и строка под ним.
  const [badLogin, setBadLogin] = useState(false)
  // Намерение входа: разрешение спрашиваем в момент нажатия, не при загрузке.
  const [micOn, setMicOn] = useState(() => localStorage.getItem(LS_MIC) === '1')
  const [camOn, setCamOn] = useState(() => localStorage.getItem(LS_CAM) === '1')

  // Доступность устройств: без микрофона/камеры кнопки серые, как в комнате
  // (enumerateDevices не требует разрешения).
  const [micAvailable, setMicAvailable] = useState(true)
  const [camAvailable, setCamAvailable] = useState(true)
  useEffect(() => {
    let alive = true
    const check = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
      if (!alive) return
      setMicAvailable(list.some((d) => d.kind === 'audioinput'))
      setCamAvailable(list.some((d) => d.kind === 'videoinput'))
    }
    void check()
    return () => {
      alive = false
    }
  }, [])

  const selected = useMemo(() => rooms.find((r) => r.name === room) ?? null, [rooms, room])

  // Живой опрос: счётчики людей и метка записи обновляются, пока человек
  // стоит на экране входа. Ошибка — «сервер не отвечает», опрос продолжается
  // (переподключение автоматическое, кнопки «повторить» нет).
  useEffect(() => {
    let stopped = false
    const poll = async () => {
      try {
        const list = await fetchRooms()
        if (stopped) return
        setRooms(list)
        setOffline(false)
        // Выбор по умолчанию — первая комната конфига; при её исчезновении
        // из конфига — снова первая.
        setRoom((cur) => (cur && list.some((r) => r.name === cur) ? cur : list[0]?.name ?? ''))
      } catch {
        if (!stopped) setOffline(true)
      }
    }
    void poll()
    const t = setInterval(poll, 5000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [])

  const askPermission = async (constraints: MediaStreamConstraints) => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    // Разрешение получено, сам захват начнёт комната: треки гасим, чтобы
    // индикатор микрофона в браузере не горел на экране входа.
    stream.getTracks().forEach((t) => t.stop())
  }

  const toggleMic = async () => {
    if (micOn) {
      setMicOn(false)
      localStorage.removeItem(LS_MIC)
      return
    }
    try {
      await askPermission({ audio: true })
      setMicOn(true)
      localStorage.setItem(LS_MIC, '1')
    } catch {
      // Разрешение не дали — остаёмся выключенными, подсказок не надо.
    }
  }

  const toggleCam = async () => {
    if (camOn) {
      setCamOn(false)
      localStorage.removeItem(LS_CAM)
      return
    }
    try {
      await askPermission({ video: true })
      setCamOn(true)
      localStorage.setItem(LS_CAM, '1')
    } catch {
      // Разрешение не дали — остаёмся выключенными.
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    setBadLogin(false)
    try {
      localStorage.setItem(LS_LOGIN, loginName.trim())
      onLogin(await login(loginName.trim(), password, selected.name))
    } catch {
      setBadLogin(true)
    } finally {
      setBusy(false)
    }
  }

  // «Этот логин уже в комнате» — предупреждение, не запрет: LiveKit пускает
  // второй сеанс с тем же identity, в сетке появится вторая плитка.
  const loginAlreadyInRoom =
    selected != null && loginName.trim() !== '' && selected.participants.some((p) => p.identity === loginName.trim())

  // Логин из конфига — свой у каждого, поэтому выбор комнаты пароль не
  // очищает (очистка была бы нужна при общем пароле на комнату).
  const dim = offline || !selected

  const visibleRooms = expanded ? rooms : rooms.slice(0, 3)
  const hiddenRooms = rooms.length - 3

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-login max-w-full space-y-6">
        {/* Блок 1: шапка и выбор комнаты */}
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Iris" className="size-6" />
            <h1 className="text-15 font-medium leading-none">Iris</h1>
          </div>
          <span className="font-mono text-10 uppercase tracking-mono text-neutral-600">{window.location.hostname}</span>
        </header>

        {rooms.length === 1 ? (
          // Одна комната в конфиге — списка нет, выбор сделан за человека.
          <h2 className="text-21 font-medium tracking-title">{rooms[0].display}</h2>
        ) : (
          <>
            <h2 className="text-21 font-medium tracking-title">Куда заходим</h2>
            <div className="space-y-1.5">
              {visibleRooms.map((r) => {
                const active = r.name === room
                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => setRoom(r.name)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-sm border px-3 py-2 text-left transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      active
                        ? 'border-primary bg-card'
                        : 'border-neutral-800 bg-transparent hover:border-neutral-700 hover:bg-card',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-3.5 flex-none items-center justify-center rounded-full border',
                        active ? 'border-primary' : 'border-neutral-700',
                      )}
                    >
                      {active && <span className="size-1.5 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13">{r.display}</span>
                      <span className="flex items-center gap-3 font-mono text-10 uppercase tracking-mono text-neutral-500">
                        {r.num_participants > 0 ? (
                          <span>
                            {r.num_participants} в комнате
                          </span>
                        ) : (
                          <span className="text-neutral-600">пусто</span>
                        )}
                        {r.recording && (
                          <span className="flex items-center gap-1">
                            <span className="size-1.25 animate-rec rounded-full bg-recording" />
                            запись
                          </span>
                        )}
                      </span>
                    </span>
                    {r.num_participants > 0 && (
                      <span className="flex flex-none items-center">
                        {r.participants.slice(0, 3).map((p, i) => (
                          // Сгенерированный аватар (DiceBear): тот же зверь,
                          // что в комнате, — seed из metadata токена.
                          <img
                            key={p.identity}
                            src={avatarUrl(p.identity, p.seed)}
                            alt={p.name}
                            className={cn(
                              'size-5.5 rounded-full border object-cover',
                              // Обводка — цветом фона строки: аватары «врезаны» в строку.
                              active ? 'border-card' : 'border-background',
                              i > 0 && '-ml-0.5',
                            )}
                          />
                        ))}
                        {r.num_participants > 3 && (
                          <span
                            className={cn(
                              'flex size-5.5 items-center justify-center rounded-full border bg-neutral-800 text-9 text-neutral-300',
                              active ? 'border-card' : 'border-background',
                              '-ml-0.5',
                            )}
                          >
                            +{r.num_participants - 3}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                )
              })}
              {!expanded && hiddenRooms > 0 && (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex items-center gap-1.5 pl-0 text-13 text-neutral-500 transition-colors hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <CaretDown size={15} />
                  Ещё {hiddenRooms} {roomsPlural(hiddenRooms)}
                </button>
              )}
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-6">
          {/* Блок 2: логин и пароль */}
          <div className={cn('space-y-3', dim && 'pointer-events-none opacity-45')}>
            <div className="space-y-1.5">
              <Label htmlFor="login" className="text-12 text-muted-foreground">
                Логин
              </Label>
              <Input
                id="login"
                value={loginName}
                onChange={(e) => {
                  setLoginName(e.target.value)
                  setBadLogin(false)
                }}
                autoComplete="username"
                className={cn(loginAlreadyInRoom && 'border-warn/50')}
                required
              />
              {loginAlreadyInRoom && (
                <p className="text-11 text-warn">Этот логин уже в комнате — второй сеанс с тем же именем.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-12 text-muted-foreground">
                Пароль
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setBadLogin(false)
                }}
                autoComplete="current-password"
                className={cn(badLogin && 'border-destructive/60')}
                required
              />
              {badLogin && <p className="text-11 text-danger-300">Логин или пароль не подошли.</p>}
            </div>
          </div>

          {/* Блок 3: микрофон и камера — с чем войти */}
          <div className={cn('flex items-center gap-3 pt-0.5', dim && 'pointer-events-none opacity-45')}>
            <button
              type="button"
              onClick={() => void toggleMic()}
              aria-pressed={micOn}
              title="Микрофон"
              disabled={!micAvailable}
              className={cn(
                'flex size-9 flex-none items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
                micOn
                  ? 'border-primary text-primary'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300',
              )}
            >
              {micOn ? <Microphone size={15} weight="fill" /> : <MicrophoneSlash size={15} />}
            </button>
            <button
              type="button"
              onClick={() => void toggleCam()}
              aria-pressed={camOn}
              title="Камера"
              disabled={!camAvailable}
              className={cn(
                'flex size-9 flex-none items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50',
                camOn
                  ? 'border-primary text-primary'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300',
              )}
            >
              {camOn ? <VideoCamera size={15} weight="fill" /> : <VideoCameraSlash size={15} />}
            </button>
            <span className="text-11 text-neutral-600">
              {micOn && camOn ? 'микрофон и камера включены' : micOn ? 'микрофон включён' : camOn ? 'камера включена' : 'выключены'}
            </span>
          </div>

          {/* Блок 4: вход */}
          {offline && (
            <div className="flex items-center gap-2 rounded-sm bg-background px-3 py-2 shadow-sm">
              <Plugs size={15} className="flex-none text-warn" />
              <span className="text-12 text-neutral-500">Сервер не отвечает, пробуем снова…</span>
            </div>
          )}
          <Button
            type="submit"
            variant="outline"
            className={cn('flex w-full items-center justify-center gap-2', offline && 'opacity-45')}
            disabled={busy || offline || !selected}
          >
            <span className="truncate">
              {busy ? 'Входим…' : `Войти в «${selected?.display ?? ''}»`}
            </span>
            <ArrowRight size={15} className="flex-none" />
          </Button>
        </form>
      </div>
    </div>
  )
}
