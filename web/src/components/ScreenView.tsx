import {
  CellSignalMedium,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  SquaresFour,
  Users,
} from '@phosphor-icons/react'
import type { Ref } from 'react'
import { Track } from 'livekit-client'
import { Video } from '@/components/Video'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/names'
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
  callBar,
}: {
  member: Member
  source: Track.Source.Camera | Track.Source.ScreenShare
  speaker: Member | undefined
  members: Member[]
  stageRef: Ref<HTMLDivElement>
  onCollapse: () => void
  callBar: React.ReactNode
}) {
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
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-neutral-900/70 text-neutral-100 shadow-sm transition-colors hover:bg-neutral-900"
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
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {members.map((m) => (
            <div
              key={m.id}
              title={m.name}
              className={cn(
                'flex flex-none items-center gap-3 rounded-sm p-2',
                m.id === member.id && 'shadow-[0_0_0_1px_var(--border)]',
              )}
            >
              {m.cameraOn && m.participant ? (
                <Video
                  participant={m.participant}
                  source={Track.Source.Camera}
                  muted={m.isLocal}
                  className="h-[28px] w-[28px] flex-none rounded-sm bg-muted object-cover"
                />
              ) : m.participant ? (
                <img
                  src={`/api/avatar/${m.participant.identity}`}
                  alt=""
                  className="h-[28px] w-[28px] flex-none rounded-sm object-cover"
                />
              ) : (
                <div className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-300">
                  {initials(m.name)}
                </div>
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
          ))}
        </div>
      </aside>
    </>
  )
}
