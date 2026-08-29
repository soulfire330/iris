import {
  CellSignalMedium,
  CornersOut,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  VideoCamera,
} from "@phosphor-icons/react";
import { Participant, Track } from "livekit-client";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/names";
import { avatarSvgUrl, avatarUrl } from "@/lib/avatars";
import { Video } from "@/components/Video";

// Аватар масштабируется с шириной плитки (cqw), пол — 40px. Кривая
// немонотонная (на lg плиток в ряду больше — аватар меньше), поэтому одной
// clamp() не обойтись: точки подобраны под реальную сетку плиток.
const avatarSize =
  "size-[max(40px,10cqw)] sm:size-[max(40px,20cqw)] lg:size-[max(40px,14cqw)] 2xl:size-[max(40px,32cqw)]";

export interface TileState {
  id?: string;
  name: string;
  role?: string;
  seed?: string;
  // data URI из снимка /api/room; нет — фолбэк на /api/avatar
  avatar?: string;
  speaking: boolean;
  muted: boolean;
  poor: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
}

// Плитка участника: аудио (инициалы + состояние) или камера (видео + полоса).
// Размер плитки не меняется при включении камеры — сетка не прыгает.
export function ParticipantTile({
  participant,
  isLocal,
  connecting,
  state,
  width,
  onExpand,
}: {
  participant?: Participant;
  isLocal?: boolean;
  // Пока комната подключается: аватарка в grayscale с «дыханием» — без
  // спиннера, чтобы сетка не дёргалась, когда плитка станет живой.
  connecting?: boolean;
  state: TileState;
  // Ширина от подбора колонок (flex-сетка); без неё — w-full.
  width?: number;
  // Развернуть поток (камеру/экран) на крупный план; undefined — нечего разворачивать.
  onExpand?: () => void;
}) {
  const { name, role, speaking, muted, poor, cameraOn, screenSharing } = state;
  // Экран в квадратике важнее камеры: демонстрацию видно и в общем виде.
  const hasVideo = (cameraOn || screenSharing) && participant;
  const videoSource = screenSharing ? Track.Source.ScreenShare : Track.Source.Camera;

  return (
    <div
      style={width ? { width: `${width}px` } : undefined}
      className={cn(
        "group @container relative aspect-video w-full max-w-full overflow-hidden rounded-md bg-card shadow-sm sm:max-w-[50cqw]",
        hasVideo ? "bg-muted" : "flex flex-col items-center justify-center gap-2 p-3",
        speaking && "shadow-speaking",
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
                <MonitorArrowUp className="size-13px flex-none text-neutral-500" />
              ) : (
                <VideoCamera weight="fill" className="size-13px flex-none text-accent-300" />
              )}
              <span className="truncate text-xs font-medium">{name}</span>
            </div>
            {muted ? (
              <MicrophoneSlash className="size-13px flex-none text-neutral-600" />
            ) : (
              <Microphone className="size-13px flex-none text-neutral-500" />
            )}
          </div>
        </>
      ) : (
        <>
          {connecting ? (
            <img
              src={state.avatar ? avatarSvgUrl(state.avatar) : avatarUrl(state.id ?? "", state.seed)}
              alt=""
              className={cn(avatarSize, "flex-none animate-breathe rounded-full bg-secondary object-cover grayscale")}
            />
          ) : participant ? (
            <img
              src={state.avatar ? avatarSvgUrl(state.avatar) : avatarUrl(participant.identity, state.seed)}
              alt=""
              className={cn(avatarSize, "flex-none rounded-full bg-secondary object-cover")}
            />
          ) : (
            <div
              className={cn(
                avatarSize,
                "flex flex-none items-center justify-center rounded-full bg-secondary text-[max(16px,3.2cqw)] font-medium text-secondary-foreground 2xl:text-[max(16px,5cqw)]",
              )}
            >
              {initials(name)}
            </div>
          )}
          <div className="flex flex-col items-center gap-1">
            <span className="max-w-full truncate text-sm font-medium">{name}</span>
            {role && <span className="font-mono text-xs text-neutral-600">{role}</span>}
          </div>
          <div className="flex h-3 items-center gap-2">
            {poor ? (
              <>
                <CellSignalMedium className="size-14px text-warn" />
                <span className="font-mono text-xs">плохая связь</span>
              </>
            ) : (
              <>
                {muted ? (
                  <MicrophoneSlash className="size-14px text-neutral-600" />
                ) : (
                  <Microphone className="size-14px text-neutral-500" />
                )}
                {screenSharing && <MonitorArrowUp className="size-14px text-neutral-500" />}
              </>
            )}
          </div>
        </>
      )}
      {onExpand && (
        <button
          onClick={onExpand}
          title="На крупный план"
          className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md text-neutral-100 opacity-100 transition-opacity group-hover:opacity-100 hover:bg-neutral-900/70 md:opacity-0"
        >
          <CornersOut className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
