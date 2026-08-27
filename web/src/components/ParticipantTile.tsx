import {
  CellSignalMedium,
  CornersOut,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  VideoCamera,
} from '@phosphor-icons/react'
import { Participant, Track } from 'livekit-client'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/names'
import { Video } from '@/components/Video'

export interface TileState {
  name: string
  role?: string
  speaking: boolean
  muted: boolean
  poor: boolean
  cameraOn: boolean
  screenSharing: boolean
}

// Плитка участника: аудио (инициалы + состояние) или камера (видео + полоса).
// Размер плитки не меняется при включении камеры — сетка не прыгает.
export function ParticipantTile({
  participant,
  isLocal,
  state,
  onExpand,
}: {
  participant?: Participant
  isLocal?: boolean
  state: TileState
  // Развернуть поток (камеру/экран) на крупный план; undefined — нечего разворачивать.
  onExpand?: () => void
}) {
  const { name, role, speaking, muted, poor, cameraOn, screenSharing } = state
  // Экран в квадратике важнее камеры: демонстрацию видно и в общем виде.
  const hasVideo = (cameraOn || screenSharing) && participant
  const videoSource = screenSharing ? Track.Source.ScreenShare : Track.Source.Camera

  return (
    <div
      className={cn(
        'group relative aspect-[16/9] w-full max-w-[50cqw] overflow-hidden rounded-md bg-card shadow-sm',
        hasVideo ? 'bg-muted' : 'flex flex-col items-center justify-center gap-2 p-3',
        speaking && 'shadow-[0_0_0_1px_var(--speaking),0_0_0_5px_var(--accent-900)]',
      )}
    >
      {hasVideo ? (
        <>
          <Video
            participant={participant}
            source={videoSource}
            muted={isLocal}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-background px-3 py-2">
            <div className="flex min-w-0 items-center gap-3">
              {screenSharing ? (
                <MonitorArrowUp className="h-[13px] w-[13px] flex-none text-neutral-500" />
              ) : (
                <VideoCamera weight="fill" className="h-[13px] w-[13px] flex-none text-accent-300" />
              )}
              <span className="truncate text-[12px] font-medium">{name}</span>
            </div>
            {muted ? (
              <MicrophoneSlash className="h-[13px] w-[13px] flex-none text-neutral-600" />
            ) : (
              <Microphone className="h-[13px] w-[13px] flex-none text-neutral-500" />
            )}
          </div>
        </>
      ) : (
        <>
          {participant ? (
            <img
              src={`/api/avatar/${participant.identity}`}
              alt=""
              className="h-[60px] w-[60px] flex-none rounded-full bg-secondary object-cover"
            />
          ) : (
            <div className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-full bg-secondary text-[18px] font-medium text-secondary-foreground">
              {initials(name)}
            </div>
          )}
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-full truncate text-[15px] font-medium">{name}</span>
            {role && <span className="font-mono text-[10px] text-neutral-600">{role}</span>}
          </div>
          <div className="flex h-3 items-center gap-2">
            {poor ? (
              <>
                <CellSignalMedium className="h-[14px] w-[14px] text-warn" />
                <span className="font-mono text-[10px]">плохая связь</span>
              </>
            ) : (
              <>
                {muted ? (
                  <MicrophoneSlash className="h-[14px] w-[14px] text-neutral-600" />
                ) : (
                  <Microphone className="h-[14px] w-[14px] text-neutral-500" />
                )}
                {screenSharing && (
                  <MonitorArrowUp className="h-[14px] w-[14px] text-neutral-500" />
                )}
              </>
            )}
          </div>
        </>
      )}
      {onExpand && (
        <button
          onClick={onExpand}
          title="На крупный план"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900/70 text-neutral-100 opacity-0 transition-opacity hover:bg-neutral-900 group-hover:opacity-100"
        >
          <CornersOut className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}