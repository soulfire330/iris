import { CellSignalMedium, Microphone, MicrophoneSlash, MonitorArrowUp, Users, VideoCamera } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { Video } from '@/components/Video'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/names'
import { avatarUrl } from '@/lib/avatars'
import type { Member } from '@/lib/members'

// Рельс участников: живёт и в раскладке демонстрации (ScreenView), и в
// раскладке «Все сводки» (SummariesView). Пока участников мало — полноценные
// 16:9 плитки (вебку видно), не влезают — обычные строки со скроллом.
// selectedId — кто на крупном плане: ему рамка и не дублируем камеру
// (hideCameraOfSelected), если на сцене именно его вебка.
export function ParticipantsRail({
  members,
  selectedId,
  hideCameraOfSelected,
  onSelect,
}: {
  members: Member[]
  selectedId: string | null
  hideCameraOfSelected: boolean
  onSelect: (m: Member) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [maxTiles, setMaxTiles] = useState(0)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      // Ниже lg рельс — горизонтальная панель: плитки не нужны, только строки.
      if (window.matchMedia('(max-width: 64rem)').matches) {
        setMaxTiles(0)
        return
      }
      const tileH = ((el.clientWidth - 24) * 9) / 16 + 6 // 16:9 + зазор 6px
      setMaxTiles(Math.max(1, Math.floor(el.clientHeight / tileH)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const useTiles = members.length <= maxTiles

  // Что показываем в плитке рельса: только вебку. Экран в 190px не показываем —
  // поток никому не нужен в таком размере, а кадры грузят сеть; вместо видео
  // у показывающего подпись «Показывает экран». Развёрнутое на крупном плане
  // не дублируем — фоллбек на камеру/полосы.
  const tileVideo = (m: Member) => {
    const staged = m.id === selectedId
    if (m.cameraOn && !(staged && hideCameraOfSelected)) return Track.Source.Camera
    return null
  }

  return (
    <aside className="flex min-h-0 flex-col border-l border-border bg-card max-lg:flex-none max-lg:border-l-0 max-lg:border-t">
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3 max-lg:hidden">
        <Users className="h-[13px] w-[13px] text-neutral-500" />
        <span className="text-[12px] font-medium">Участники</span>
        <span className="ml-auto font-mono text-[10px] text-neutral-600">{members.length}</span>
      </div>
      <div
        ref={railRef}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3 max-lg:flex-row max-lg:gap-2 max-lg:overflow-x-auto max-lg:overflow-y-hidden max-lg:p-2"
      >
        {useTiles ? (
          members.map((m) => {
            const videoSource = tileVideo(m)
            const clickable = !!(m.cameraOn || m.screenSharing)
            const staged = m.id === selectedId
            return (
              <div
                key={m.id}
                title={m.name}
                onClick={clickable ? () => onSelect(m) : undefined}
                className={cn(
                  'relative aspect-[16/9] w-full flex-none overflow-hidden rounded-sm border border-border bg-neutral-900',
                  // Выбранный — толще серая рамка, как «говорит», но серым;
                  // реально говорящий перекрывает цветной индикацией.
                  staged && !m.speaking && 'border-2 border-[#6b7280]',
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
                ) : staged && hideCameraOfSelected ? (
                  // Поток развёрнут на крупном плане — не дублируем: полосы.
                  <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--color-neutral-800)_0_6px,var(--color-neutral-900)_6px_12px)]" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                    {m.participant ? (
                      <img
                        src={avatarUrl(m.participant.identity, m.seed)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-[14px] font-medium text-secondary-foreground">
                        {initials(m.name)}
                      </span>
                    )}
                  </div>
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
                        <MonitorArrowUp className="h-[10px] w-[10px] flex-none text-destructive" />
                      )}
                      {m.cameraOn && (
                        <VideoCamera className="h-[10px] w-[10px] flex-none text-destructive" />
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
            const staged = m.id === selectedId
            return (
              <div
                key={m.id}
                title={m.name}
                onClick={clickable ? () => onSelect(m) : undefined}
                className={cn(
                  'flex flex-none items-center gap-3 rounded-sm p-2',
                  'max-lg:w-16 max-lg:flex-col max-lg:gap-1 max-lg:p-1',
                  staged && !m.speaking && 'shadow-[0_0_0_2px_#6b7280]',
                  m.speaking && 'shadow-[0_0_0_1px_var(--speaking),0_0_0_5px_var(--accent-900)]',
                  clickable && 'cursor-pointer hover:bg-primary/5',
                )}
              >
                {videoSource && m.participant ? (
                  <Video
                    participant={m.participant}
                    source={videoSource}
                    muted={m.isLocal}
                    className="h-[28px] w-[28px] flex-none rounded-sm bg-muted object-cover max-lg:h-10 max-lg:w-10 max-lg:rounded-full"
                  />
                ) : staged && hideCameraOfSelected ? (
                  <div className="h-[28px] w-[28px] flex-none rounded-sm bg-[repeating-linear-gradient(135deg,var(--color-neutral-800)_0_6px,var(--color-neutral-900)_6px_12px)] max-lg:h-10 max-lg:w-10 max-lg:rounded-full" />
                ) : m.participant ? (
                  <img
                    src={avatarUrl(m.participant.identity, m.seed)}
                    alt=""
                    className="h-[28px] w-[28px] flex-none rounded-sm object-cover max-lg:h-10 max-lg:w-10 max-lg:rounded-full"
                  />
                ) : (
                  <div className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-300 max-lg:h-10 max-lg:w-10">
                    {initials(m.name)}
                  </div>
                )}
                <span className="flex-1 truncate text-[12px] max-lg:w-full max-lg:text-center max-lg:text-[10px]">
                  {m.name}
                </span>
                {m.poor ? (
                  <CellSignalMedium className="h-[13px] w-[13px] flex-none text-warn max-lg:hidden" />
                ) : (
                  <>
                    {m.muted ? (
                      <MicrophoneSlash className="h-[13px] w-[13px] flex-none text-neutral-600 max-lg:hidden" />
                    ) : (
                      <Microphone className="h-[13px] w-[13px] flex-none text-neutral-500 max-lg:hidden" />
                    )}
                    {m.screenSharing && (
                      <MonitorArrowUp className="h-[13px] w-[13px] flex-none text-destructive max-lg:hidden" />
                    )}
                    {m.cameraOn && (
                      <VideoCamera className="h-[13px] w-[13px] flex-none text-destructive max-lg:hidden" />
                    )}
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
