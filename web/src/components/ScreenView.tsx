import { SquaresFour } from "@phosphor-icons/react";
import type { Ref } from "react";
import { Track } from "livekit-client";
import { Video } from "@/components/Video";
import { ParticipantsRail } from "@/components/ParticipantsRail";
import type { Member } from "@/lib/members";

// Раскладка «крупный план»: выбранный поток (экран или камера) на весь левый
// край, участники — рельсом (ParticipantsRail). Панель сводок/чата — третьей
// колонкой в RoomPage.
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
  member: Member;
  source: Track.Source.Camera | Track.Source.ScreenShare;
  speaker: Member | undefined;
  members: Member[];
  stageRef: Ref<HTMLDivElement>;
  onCollapse: () => void;
  // Клик по участнику в рельсе — поставить его поток на крупный план.
  onSelect: (m: Member) => void;
  callBar: React.ReactNode;
}) {
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-col gap-6 p-6">
        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-neutral-900 shadow-sm">
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
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-neutral-100 transition-colors hover:bg-neutral-900/70"
          >
            <SquaresFour className="h-4 w-4" />
          </button>
          {speaker && (
            <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-full bg-background px-3 py-1.5 shadow-sm">
              <span className="text-xs font-medium">{speaker.name} говорит</span>
            </div>
          )}
        </div>
        {callBar}
      </div>

      <ParticipantsRail
        members={members}
        selectedId={member.id}
        hideCameraOfSelected={source === Track.Source.Camera}
        onSelect={onSelect}
      />
    </>
  );
}
