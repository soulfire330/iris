import { CornersOut } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent, Track, type LocalTrackPublication } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { CallBar } from '@/components/CallBar'
import { ParticipantTile } from '@/components/ParticipantTile'
import { RoomHeader } from '@/components/RoomHeader'
import { ScreenView } from '@/components/ScreenView'
import { SecretaryPanel, type PanelTab } from '@/components/SecretaryPanel'
import { useChat } from '@/hooks/useChat'
import { DEFAULT_DSP, useRoom } from '@/hooks/useRoom'
import { fetchRecordings, startRecording, stopRecording, type RecordingFile, type Session } from '@/lib/api'
import { fromParticipant, type Member } from '@/lib/members'
import { cn } from '@/lib/utils'

export function RoomPage({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [panelOpen, setPanelOpen] = useState(false)
  // Таб правой колонки живёт здесь, а не в SecretaryPanel: панель монтируется
  // в трёх местах (колонка, рельс, оверлей), и состояние должно быть одно.
  const [panel, setPanel] = useState<PanelTab>('summaries')
  // Микрофон/камера/экран: состояние в UI — источник правды, LiveKit — следствие.
  // (Геттеры LiveKit для локальных треков не меняются на mute — по ним UI не жил.)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  // Крупный план: любой видеопоток (экран или камера) можно развернуть кнопкой
  // на плитке и свернуть кнопкой в углу. Экран при старте выходит сам.
  const [stage, setStage] = useState<{ id: string; source: Track.Source.Camera | Track.Source.ScreenShare } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const { room, remote, speakers, connected, error, startedAt, clockOffsetMs } = useRoom(session.token, DEFAULT_DSP)
  const local = room.localParticipant
  const chat = useChat(
    room,
    { identity: local?.identity ?? '', name: session.name, seed: session.avatar_seed },
    panel === 'chat',
  )

  // Счётчик непрочитанного в заголовке вкладки, пока она неактивна
  // (дизайн: состояние комнаты выносится в document.title).
  useEffect(() => {
    const sync = () => {
      document.title =
        chat.unread > 0 && document.hidden ? `(${chat.unread}) Iris · общая комната` : 'Iris · общая комната'
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [chat.unread])

  // Переключение на таб чата гасит счётчик непрочитанного.
  const onPanelChange = (t: PanelTab) => {
    setPanel(t)
    if (t === 'chat') chat.markRead()
  }

  // Браузер остановил показ сам (нативная плашка «Стоп»): LiveKit отзывает
  // публикацию, а UI узнаёт только из события — вернуть раскладку в сетку.
  useEffect(() => {
    const onUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) setScreenOn(false)
    }
    room.on(RoomEvent.LocalTrackUnpublished, onUnpublished)
    return () => {
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished)
    }
  }, [room])

  // Запись: состояние — метаданные комнаты (бэкенд пишет их при старте/стопе
  // egress), поэтому тег и кнопка синхронны у всех участников. При
  // подключении берём текущее значение — запись могла идти до нас.
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    const sync = (meta: string) => setRecording(meta.includes('"recording":true'))
    sync(room.metadata ?? '')
    room.on(RoomEvent.RoomMetadataChanged, sync)
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, sync)
    }
  }, [room, connected])

  // Короткий сигнал на старт/стоп (решение Q4): все слышат, что их
  // записывают. WebAudio, без ассетов.
  const beep = (freq: number) => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    osc.onended = () => void ctx.close()
  }
  const prevRecording = useRef(recording)
  useEffect(() => {
    if (recording === prevRecording.current) return
    prevRecording.current = recording
    beep(recording ? 880 : 440)
  }, [recording])

  const [actionError, setActionError] = useState('')
  // Тик принудительного обновления списка записей: файл финализируется
  // egress'ом с задержкой после стопа — без повтора список висит пустым.
  const [recTick, setRecTick] = useState(0)
  const onRecord = async () => {
    setActionError('')
    try {
      if (recording) {
        await stopRecording()
        setTimeout(() => setRecTick((t) => t + 1), 2000)
      } else {
        await startRecording(session.login)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  // Список записей для таба «Сводки»: тянем при входе в комнату и после
  // каждого старта/стопа записи и по тику после стопа (файл дописывается).
  // Без panelOpen в условии: на широком экране колонка видна всегда, а
  // panelOpen описывает только оверлей на узком.
  const [recordings, setRecordings] = useState<RecordingFile[]>([])
  useEffect(() => {
    if (panel !== 'summaries') return
    let alive = true
    fetchRecordings()
      .then((list) => alive && setRecordings(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [panel, panelOpen, recording, recTick])

  // Доступность устройств: без микрофона/камеры кнопки серые. Проверяем по
  // перечню устройств (enumerateDevices не требует разрешения).
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

  // Таймер встречи: тикает локально, но время — серверное (now + сдвиг часов),
  // поэтому у всех участников одинаковые цифры.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const elapsed = startedAt ? Math.max(0, now + clockOffsetMs - startedAt.getTime()) : 0

  const members: Member[] = useMemo(() => {
    const list: Member[] = []
    if (local) {
      list.push({
        id: local.identity,
        participant: local,
        isLocal: true,
        name: `${session.name} (вы)`,
        role: session.role,
        seed: session.avatar_seed,
        speaking: speakers.has(local.identity),
        muted: !micOn,
        poor: false,
        cameraOn: camOn,
        screenSharing: screenOn,
      })
    }
    for (const p of remote) list.push(fromParticipant(p, false, speakers.has(p.identity)))
    return list
  }, [local, remote, speakers, session, micOn, camOn, screenOn])

  const sharer = members.find((m) => m.screenSharing)
  // Демонстрация занимает крупный план сама: кто первый начал — тот в приоритете.
  // Смена показывающего (или завершение показа) переключает/снимает крупный план;
  // ручной выбор (вебка/свёрнутый вид) при этом не сбрасывается.
  useEffect(() => {
    if (sharer) setStage({ id: sharer.id, source: Track.Source.ScreenShare })
    else if (stage?.source === Track.Source.ScreenShare) setStage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharer?.id])
  const stageMember = stage ? members.find((m) => m.id === stage.id) : undefined
  const layout: 'grid' | 'stage' = stageMember ? 'stage' : 'grid'

  // Клик по участнику в рельсе — на крупный план, экран приоритетнее вебки.
  const selectStage = (m: Member) => {
    if (m.screenSharing) setStage({ id: m.id, source: Track.Source.ScreenShare })
    else if (m.cameraOn) setStage({ id: m.id, source: Track.Source.Camera })
  }

  // Развёрнутый источник исчез (выключили камеру/экран) — крупный план закрываем.
  // Но сначала: если человек перешёл с вебки на экран — крупный план следует
  // за ним (иначе гонка с «источник исчез» падала бы в сетку).
  useEffect(() => {
    if (!stage || !stageMember) return
    if (stage.source === Track.Source.Camera && stageMember.screenSharing) {
      setStage({ id: stageMember.id, source: Track.Source.ScreenShare })
      return
    }
    const has = stage.source === Track.Source.ScreenShare ? stageMember.screenSharing : stageMember.cameraOn
    if (!has) setStage(null)
  }, [stage, stageMember])
  const speaker = members.find((m) => m.speaking)

  // Колонки от числа участников (диздок «Геометрия плитки»):
  // 1 → 1 · 2 → 2 · 3—4 → 2 · 5—9 → 3 · 10+ → 4.
  const tileCols =
    members.length >= 10 ? 'grid-cols-4' : members.length >= 5 ? 'grid-cols-3' : members.length >= 2 ? 'grid-cols-2' : 'grid-cols-1'

  // Выключение = unpublishTrack: LiveKit mute() оставляет устройство живым
  // (индикатор микрофона в браузере не гаснет), а unpublish останавливает источник.
  // UI оптимистичный: кнопка переключается сразу, откат — только при ошибке.
  const setMic = async (on: boolean) => {
    if (!local) return
    setMicOn(on)
    try {
      if (on) await local.setMicrophoneEnabled(true)
      else {
        const pub = local.getTrackPublication(Track.Source.Microphone)
        if (pub?.track) await local.unpublishTrack(pub.track)
      }
    } catch {
      setMicOn(!on)
    }
  }
  const setCam = async (on: boolean) => {
    if (!local) return
    setCamOn(on)
    try {
      if (on) await local.setCameraEnabled(true)
      else {
        const pub = local.getTrackPublication(Track.Source.Camera)
        if (pub?.track) await local.unpublishTrack(pub.track)
      }
    } catch {
      setCamOn(!on)
    }
  }
  const setScreen = async (on: boolean) => {
    if (!local) return
    setScreenOn(on)
    try {
      if (!on) {
        await local.setScreenShareEnabled(false)
        return
      }
      // Без явного encoding SDK берёт h1080fps15 для экранов ≥1920: потолок
      // 15fps/2.5Mbps. Явно даём FHD 30fps/8Mbps (LAN потянет).
      await local.setScreenShareEnabled(true, { video: true, contentHint: 'motion' }, {
        screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 30 },
      })
    } catch {
      setScreenOn(!on)
    }
  }

  const callBar = (extra?: React.ReactNode) => (
    <CallBar
      muted={!micOn}
      cameraOn={camOn}
      screenOn={screenOn}
      recording={recording}
      micAvailable={micAvailable}
      camAvailable={camAvailable}
      onMic={() => void setMic(!micOn)}
      onCamera={() => void setCam(!camOn)}
      onScreen={() => void setScreen(!screenOn)}
      onRecord={() => void onRecord()}
      onLeave={onLeave}
      extra={extra}
    />
  )

  const panelToggle = (
    <Button
      variant="ghost"
      className="gap-2 text-[12px] min-[1181px]:hidden"
      onClick={() => setPanelOpen(true)}
    >
      Сводки и чат
    </Button>
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <RoomHeader
        count={members.length}
        elapsed={elapsed}
        recording={recording}
        secretary={false}
        screenLabel={
          // Тег в шапке: «Экран», если кто-то демонстрирует (независимо от того,
          // чей поток на крупном плане); иначе — развёрнутая камера.
          sharer
            ? 'Экран'
            : stage && stageMember
              ? `камера ${stageMember.name}`
              : undefined
        }
      />
      {(error || actionError) && (
        <div className="flex-none border-b border-border bg-card px-6 py-1.5 font-mono text-[11px] text-warn">
          {error || actionError}
        </div>
      )}

      <div
        className={cn(
          'grid min-h-0 flex-1',
          layout === 'stage'
            ? '[grid-template-columns:1fr_208px_300px] max-[900px]:[grid-template-columns:1fr]'
            : '[grid-template-columns:1fr_300px] max-[1180px]:[grid-template-columns:1fr]',
        )}
      >
        {stage && stageMember ? (
          <ScreenView
            member={stageMember}
            source={stage.source}
            members={members}
            speaker={speaker}
            stageRef={stageRef}
            onCollapse={() => setStage(null)}
            onSelect={selectStage}
            callBar={callBar(
              !stageMember.isLocal && (
                <Button
                  variant="ghost"
                  className="gap-2 text-[12px]"
                  onClick={() => stageRef.current?.requestFullscreen()}
                >
                  <CornersOut className="h-[15px] w-[15px]" />
                  <span>Во весь экран</span>
                </Button>
              ),
            )}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-4 p-6">
            <div
              className={cn(
                'grid min-h-0 flex-1 content-center justify-items-center gap-3 @container',
                tileCols,
                'max-[1180px]:grid-cols-2 max-[900px]:grid-cols-1',
              )}
            >
              {!connected && !error && (
                <div className="col-span-full flex items-center justify-center py-12 font-mono text-[11px] text-neutral-600">
                  Подключаемся…
                </div>
              )}
              {members.map((m) => (
                <ParticipantTile
                  key={m.id}
                  participant={m.participant}
                  isLocal={m.isLocal}
                  state={{
                    name: m.name,
                    role: m.role,
                    seed: m.seed,
                    speaking: m.speaking,
                    muted: m.muted,
                    poor: m.poor,
                    cameraOn: m.cameraOn,
                    screenSharing: m.screenSharing,
                  }}
                  onExpand={
                    (m.cameraOn || m.screenSharing) && m.participant
                      ? () =>
                          setStage({
                            id: m.id,
                            source: m.screenSharing ? Track.Source.ScreenShare : Track.Source.Camera,
                          })
                      : undefined
                  }
                />
              ))}
            </div>
            {callBar(panelToggle)}
          </div>
        )}

        {layout === 'stage' ? (
          // В раскладке показа экран 16:9 оставляет место по бокам — колонки
          // живут вместе: рельс участников и панель секретаря одновременно.
          <SecretaryPanel
            tab={panel}
            onTabChange={onPanelChange}
            messages={chat.messages}
            unread={chat.unread}
            connected={connected}
            onSend={chat.send}
            recordings={recordings}
            recording={recording}
          />
        ) : (
          <div className="hidden max-[1180px]:hidden min-[1181px]:block">
            <SecretaryPanel
              tab={panel}
              onTabChange={onPanelChange}
              messages={chat.messages}
              unread={chat.unread}
              connected={connected}
              onSend={chat.send}
            recordings={recordings}
            recording={recording}
            />
          </div>
        )}
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-neutral-900/50" onClick={() => setPanelOpen(false)}>
          <div className="h-full" onClick={(e) => e.stopPropagation()}>
            <SecretaryPanel
              tab={panel}
              onTabChange={onPanelChange}
              messages={chat.messages}
              unread={chat.unread}
              connected={connected}
              onSend={chat.send}
            recordings={recordings}
            recording={recording}
            />
          </div>
        </div>
      )}
    </div>
  )
}