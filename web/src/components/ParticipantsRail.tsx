import {
  CellSignalMedium,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  Users,
  VideoCamera,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Track } from "livekit-client";
import { Video } from "@/components/Video";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/names";
import { avatarUrl } from "@/lib/avatars";
import type { Member } from "@/lib/members";

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
  members: Member[];
  selectedId: string | null;
  hideCameraOfSelected: boolean;
  onSelect: (m: Member) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [maxTiles, setMaxTiles] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Ниже lg рельс — горизонтальная панель: плитки не нужны, только строки.
      if (window.matchMedia("(max-width: 64rem)").matches) {
        setMaxTiles(0);
        return;
      }
      const tileH = ((el.clientWidth - 24) * 9) / 16 + 6; // 16:9 + зазор 6px
      setMaxTiles(Math.max(1, Math.floor(el.clientHeight / tileH)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const useTiles = members.length <= maxTiles;

  // Что показываем в плитке рельса: только вебку. Экран в 190px не показываем —
  // поток никому не нужен в таком размере, а кадры грузят сеть; вместо видео
  // у показывающего подпись «Показывает экран». Развёрнутое на крупном плане
  // не дублируем — фоллбек на камеру/полосы.
  const tileVideo = (m: Member) => {
    const staged = m.id === selectedId;
    if (m.cameraOn && !(staged && hideCameraOfSelected)) return Track.Source.Camera;
    return null;
  };

  return (
    <aside className="flex min-h-0 flex-none flex-col border-t border-l-0 bg-card lg:border-t-0 lg:border-l">
      <div className="hidden items-center gap-2 border-b px-3 py-3 lg:flex">
        <Users className="size-13px text-neutral-500" />
        <span className="text-xs font-medium">Участники</span>
        <span className="ml-auto font-mono text-xs text-neutral-600">{members.length}</span>
      </div>
      <div
        ref={railRef}
        className="flex min-h-0 flex-1 flex-row gap-2 overflow-x-auto overflow-y-hidden p-2 lg:flex-col lg:gap-1.5 lg:overflow-x-auto lg:overflow-y-auto lg:p-3"
      >
        {useTiles
          ? members.map((m) => {
              const videoSource = tileVideo(m);
              const clickable = !!(m.cameraOn || m.screenSharing);
              const staged = m.id === selectedId;
              return (
                <div
                  key={m.id}
                  title={m.name}
                  onClick={clickable ? () => onSelect(m) : undefined}
                  className={cn(
                    "relative aspect-video w-full flex-none overflow-hidden rounded-sm border border-border bg-neutral-900",
                    // Выбранный — толще серая рамка, как «говорит», но серым;
                    // реально говорящий перекрывает цветной индикацией.
                    staged && !m.speaking && "border-2 border-staged",
                    m.speaking && "shadow-speaking",
                    clickable && "cursor-pointer",
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
                    <div className="absolute inset-0 bg-stripes" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                      {m.participant ? (
                        <img
                          src={avatarUrl(m.participant.identity, m.seed)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-secondary-foreground">{initials(m.name)}</span>
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-background/90 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate text-xs">{m.name}</span>
                    {m.poor ? (
                      <CellSignalMedium className="size-10px flex-none text-warn" />
                    ) : (
                      <>
                        {m.muted ? (
                          <MicrophoneSlash className="size-10px flex-none text-neutral-600" />
                        ) : (
                          <Microphone className="size-10px flex-none text-neutral-500" />
                        )}
                        {m.screenSharing && <MonitorArrowUp className="size-10px flex-none text-destructive" />}
                        {m.cameraOn && <VideoCamera className="size-10px flex-none text-destructive" />}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          : members.map((m) => {
              const videoSource = tileVideo(m);
              const clickable = !!(m.cameraOn || m.screenSharing);
              const staged = m.id === selectedId;
              return (
                <div
                  key={m.id}
                  title={m.name}
                  onClick={clickable ? () => onSelect(m) : undefined}
                  className={cn(
                    "flex w-16 flex-none flex-col items-center gap-1 rounded-sm p-1 lg:w-auto lg:flex-row lg:gap-3 lg:p-2",
                    staged && !m.speaking && "ring-2 ring-staged",
                    m.speaking && "shadow-speaking",
                    clickable && "cursor-pointer hover:bg-primary/5",
                  )}
                >
                  {videoSource && m.participant ? (
                    <Video
                      participant={m.participant}
                      source={videoSource}
                      muted={m.isLocal}
                      className="h-10 w-10 flex-none rounded-full bg-muted object-cover lg:size-28px lg:rounded-sm"
                    />
                  ) : staged && hideCameraOfSelected ? (
                    <div className="h-10 w-10 flex-none rounded-full bg-stripes lg:size-28px lg:rounded-sm" />
                  ) : m.participant ? (
                    <img
                      src={avatarUrl(m.participant.identity, m.seed)}
                      alt=""
                      className="h-10 w-10 flex-none rounded-full object-cover lg:size-28px lg:rounded-sm"
                    />
                  ) : (
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-neutral-300 lg:size-28px">
                      {initials(m.name)}
                    </div>
                  )}
                  <span className="w-full flex-1 truncate text-center text-xs lg:w-auto lg:text-left lg:text-xs">
                    {m.name}
                  </span>
                  {m.poor ? (
                    <CellSignalMedium className="hidden size-13px flex-none text-warn lg:block" />
                  ) : (
                    <>
                      {m.muted ? (
                        <MicrophoneSlash className="hidden size-13px flex-none text-neutral-600 lg:block" />
                      ) : (
                        <Microphone className="hidden size-13px flex-none text-neutral-500 lg:block" />
                      )}
                      {m.screenSharing && (
                        <MonitorArrowUp className="hidden size-13px flex-none text-destructive lg:block" />
                      )}
                      {m.cameraOn && <VideoCamera className="hidden size-13px flex-none text-destructive lg:block" />}
                    </>
                  )}
                </div>
              );
            })}
      </div>
    </aside>
  );
}
