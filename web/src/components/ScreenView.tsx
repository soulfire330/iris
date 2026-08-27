import {
  CellSignalMedium,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  SquaresFour,
  Users,
} from '@phosphor-icons/react'
import type { Ref } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { Video } from '@/components/Video'
import { cn } from '@/lib/utils'
import type { Member } from '@/lib/members'

// Раскладка «крупный план»: выбранный поток (экран или камера) на весь левый
// край, участники — рельсом. Панель сводок/чата — третьей колонкой в RoomPage.
export function ScreenView({
  member,
  source,
  speaker,
  members,
  stageRef,
  onCollapse,
  onSelect,
  callBar,
}: {
  member: Member
  source: Track.Source.Camera | Track.Source.ScreenShare
  speaker: Member | undefined
  members: Member[]
  stageRef: Ref<HTMLDivElement>
  onCollapse: () => void
  // Клик по участнику в рельсе — поставить его поток на крупный план.
  onSelect: (m: Member) => void
  callBar: React.ReactNode
}) {
  // Пока участников мало — рельс показывает полноценные 16:9 плитки (вебку
  // видно), не влезают — обычные строки со скроллом.
  const railRef = useRef<HTMLDivElement>(null)
  const [maxTiles, setMaxTiles] = useState(0)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const tileH = ((el.clientWidth - 24) * 9) / 16 + 6 // 16:9 + зазор 6px
      setMaxTiles(Math.max(1, Math.floor(el.clientHeight / tileH)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const useTiles = members.length <= maxTiles

  // Что показываем в плитке рельса: экран приоритетнее вебки, но то, что уже
  // развёрнуто на крупном плане, не дублируем — фоллбек на камеру/аватарку.
  const tileVideo = (m: Member) => {
    const staged = m.id === member.id
    if (m.screenSharing && !(staged && source === Track.Source.ScreenShare))
      return Track.Source.ScreenShare
    if (m.cameraOn && !(staged && source === Track.Source.Camera)) return Track.Source.Camera
    return null
  }

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-col gap-6 p-6">
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-neutral-900 shadow-sm"
        >
          {member.participant && (
            <Video
              participant={member.participant}
              source={source}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
          {/* Возврат к общему виду конференции */}
          <button
            onClick={onCollapse}
            title="К общему виду"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-neutral-100 transition-colors hover:bg-neutral-900/70"
          >
            <SquaresFour className="h-4 w-4" />
          </button>
          {speaker && (
            <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-full bg-background px-3 py-1.5 shadow-sm">
              <span className="text-[12px] font-medium">{speaker.name} говорит</span>
            </div>
          )}
        </div>
        {callBar}
      </div>

      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <Users className="h-[13px] w-[13px] text-neutral-500" />
          <span className="text-[12px] font-medium">Участники</span>
          <span className="ml-auto font-mono text-[10px] text-neutral-600">{members.length}</span>
        </div>
        <div ref={railRef} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {useTiles ? (
            members.map((m) => {
              const videoSource = tileVideo(m)
              const clickable = !!(m.cameraOn || m.screenSharing)
              return (
                <div
                  key={m.id}
                  title={m.name}
                  onClick={clickable ? () => onSelect(m) : undefined}
                  className={cn(
                    'relative aspect-[16/9] w-full flex-none overflow-hidden rounded-sm border border-border bg-neutral-900',
                    // Выбранный — толще серая рамка, как «говорит», но серым;
                    // реально говорящий перекрывает цветной индикацией.
                    m.id === member.id && !m.speaking && 'border-2 border-[#6b7280]',
                    m.speaking && 'shadow-[0_0_0_1px_var(--speaking),0_0_0_5px_var(--accent-900)]',
                    clickable && 'cursor-pointer',
                  )}
                >
                  {videoSource && m.participant ? (
                    <Video
                      participant={m.participant}
                      source={videoSource}
                      muted={m.isLocal}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    // Нет видео (фоллбек с крупного плана или вебка выключена) —
                    // диагональные полосы вместо аватарки.
                    <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--color-neutral-800)_0_6px,var(--color-neutral-900)_6px_12px)]" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-background/90 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
                    {m.poor ? (
                      <CellSignalMedium className="h-[10px] w-[10px] flex-none text-warn" />
                    ) : (
                      <>
                        {m.muted ? (
                          <MicrophoneSlash className="h-[10px] w-[10px] flex-none text-neutral-600" />
                        ) : (
                          <Microphone className="h-[10px] w-[10px] flex-none text-neutral-500" />
                        )}
                        {m.screenSharing && (
                          <MonitorArrowUp className="h-[10px] w-[10px] flex-none text-neutral-500" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            members.map((m) => {
              const videoSource = tileVideo(m)
              const clickable = !!(m.cameraOn || m.screenSharing)
              return (
                <div
                  key={m.id}
                  title={m.name}
                  onClick={clickable ? () => onSelect(m) : undefined}
                  className={cn(
                    'flex flex-none items-center gap-3 rounded-sm p-2',
                    m.id === member.id && !m.speaking && 'shadow-[0_0_0_2px_#6b7280]',
                    m.speaking && 'shadow-[0_0_0_1px_var(--speaking),0_0_0_5px_var(--accent-900)]',
                    clickable && 'cursor-pointer hover:bg-primary/5',
                  )}
                >
                  {videoSource && m.participant ? (
                    <Video
                      participant={m.participant}
                      source={videoSource}
                      muted={m.isLocal}
                      className="h-[28px] w-[28px] flex-none rounded-sm bg-muted object-cover"
                    />
                  ) : (
                    <div className="h-[28px] w-[28px] flex-none rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-neutral-800)_0_6px,var(--color-neutral-900)_6px_12px)]" />
                  )}
                  <span className="flex-1 truncate text-[12px]">{m.name}</span>
                  {m.poor ? (
                    <CellSignalMedium className="h-[13px] w-[13px] flex-none text-warn" />
                  ) : (
                    <>
                      {m.muted ? (
                        <MicrophoneSlash className="h-[13px] w-[13px] flex-none text-neutral-600" />
                      ) : (
                        <Microphone className="h-[13px] w-[13px] flex-none text-neutral-500" />
                      )}
                      {m.screenSharing && (
                        <MonitorArrowUp className="h-[13px] w-[13px] flex-none text-neutral-500" />
                      )}
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}
