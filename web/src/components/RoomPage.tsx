import { CornersOut, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { CallBar } from '@/components/CallBar'
import { ParticipantTile } from '@/components/ParticipantTile'
import { RoomHeader } from '@/components/RoomHeader'
import { ScreenView } from '@/components/ScreenView'
import { SecretaryPanel } from '@/components/SecretaryPanel'
import { DEFAULT_DSP, useRoom } from '@/hooks/useRoom'
import type { Session } from '@/lib/api'
import { fromParticipant, type Member } from '@/lib/members'
import { cn } from '@/lib/utils'

export function RoomPage({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [panelOpen, setPanelOpen] = useState(false)
  // Микрофон/камера/экран: состояние в UI — источник правды, LiveKit — следствие.
  // (Геттеры LiveKit для локальных треков не меняются на mute — по ним UI не жил.)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const { room, remote, speakers, connected, error, startedAt, clockOffsetMs } = useRoom(session.token, DEFAULT_DSP)
  const local = room.localParticipant

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
  const layout: 'grid' | 'screen' = sharer ? 'screen' : 'grid'
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
      await local.setScreenShareEnabled(on)
    } catch {
      setScreenOn(!on)
    }
  }

  const callBar = (extra?: React.ReactNode) => (
    <CallBar
      muted={!micOn}
      cameraOn={camOn}
      onMic={() => void setMic(!micOn)}
      onCamera={() => void setCam(!camOn)}
      onScreen={() => void setScreen(!screenOn)}
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
        recording={false}
        secretary={false}
        screenLabel={layout === 'screen' && sharer ? `экран ${sharer.name}` : undefined}
      />
      {error && (
        <div className="flex-none border-b border-border bg-card px-6 py-1.5 font-mono text-[11px] text-warn">
          {error}
        </div>
      )}

      <div
        className={cn(
          'grid min-h-0 flex-1',
          layout === 'screen'
            ? '[grid-template-columns:1fr_208px] max-[900px]:[grid-template-columns:1fr]'
            : '[grid-template-columns:1fr_300px] max-[1180px]:[grid-template-columns:1fr]',
        )}
      >
        {layout === 'screen' && sharer ? (
          <ScreenView
            sharer={sharer}
            members={members}
            speaker={speaker}
            stageRef={stageRef}
            onPanel={() => setPanelOpen(true)}
            callBar={callBar(
              <>
                <Button
                  variant="ghost"
                  className="gap-2 text-[12px]"
                  onClick={() => stageRef.current?.requestFullscreen()}
                >
                  <CornersOut className="h-[15px] w-[15px]" />
                  <span>Во весь экран</span>
                </Button>
                {sharer.isLocal && (
                  <Button
                    variant="secondary"
                    className="gap-2 text-[12px]"
                    onClick={() => void setScreen(false)}
                  >
                    <X className="h-[15px] w-[15px]" />
                    <span>Свернуть показ</span>
                  </Button>
                )}
              </>,
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
                      speaking: m.speaking,
                      muted: m.muted,
                      poor: m.poor,
                      cameraOn: m.cameraOn,
                      screenSharing: m.screenSharing,
                    }}
                  />
                ))}
            </div>
            {callBar(panelToggle)}
          </div>
        )}

        {layout === 'screen' ? null : (
          <div className="hidden max-[1180px]:hidden min-[1181px]:block">
            <SecretaryPanel />
          </div>
        )}
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-neutral-900/50" onClick={() => setPanelOpen(false)}>
          <div className="h-full" onClick={(e) => e.stopPropagation()}>
            <SecretaryPanel />
          </div>
        </div>
      )}
    </div>
  )
}