import {
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  Record,
  SignOut,
  Sparkle,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CallBarProps {
  muted: boolean;
  cameraOn: boolean;
  screenOn: boolean;
  recording: boolean;
  aiSummary: boolean; // идёт запись со сводкой (AI-кнопка)
  micAvailable: boolean;
  camAvailable: boolean;
  onMic: () => void;
  onCamera: () => void;
  onScreen: () => void;
  onRecord: () => void;
  onAi: () => void;
  onLeave: () => void;
  extra?: ReactNode; // «Во весь экран» для зрителей показа
  onPanel?: () => void;
  onClosePanel?: () => void;
}

export function CallBar(p: CallBarProps) {
  // Демонстрация экрана недоступна на iOS (нет getDisplayMedia) — прячем кнопку.
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-4 rounded-md bg-card p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <IconButton
          onClick={p.onMic}
          active={!p.muted}
          activeClass="text-primary"
          disabled={!p.micAvailable}
          label={p.muted ? "Включить микрофон" : "Выключить микрофон"}
          className="border-primary/40"
        >
          {p.muted ? <MicrophoneSlash /> : <Microphone weight="fill" />}
        </IconButton>
        {canShare && (
          <IconButton
            onClick={p.onScreen}
            active={p.screenOn}
            activeClass="text-destructive"
            label={p.screenOn ? "Закончить демонстрацию" : "Начать демонстрацию"}
          >
            <MonitorArrowUp />
          </IconButton>
        )}
        <IconButton
          onClick={p.onCamera}
          active={p.cameraOn}
          activeClass="text-destructive"
          disabled={!p.camAvailable}
          label={p.cameraOn ? "Выключить камеру" : "Включить камеру"}
        >
          <VideoCamera />
        </IconButton>
        <span className="h-6 w-px bg-neutral-600/50" />
        <IconButton
          onClick={p.onRecord}
          active={p.recording}
          activeClass="text-recording"
          label={p.recording ? "Остановить запись" : "Записать звонок"}
        >
          <Record weight={p.recording ? "fill" : "regular"} />
        </IconButton>
        {/* AI-сводка: появляется только при идущей записи (решение: не путать
            со стартом записи) и заказывает сводку для неё. Уже заказана —
            кнопка серая, повторный клик ничего не делает. */}
        {p.recording && (
          <IconButton
            onClick={p.onAi}
            active={p.aiSummary}
            activeClass="text-ai"
            disabled={p.aiSummary}
            label={p.aiSummary ? "Сводка заказана" : "Заказать AI-сводку"}
          >
            <Sparkle weight={p.aiSummary ? "fill" : "regular"} />
          </IconButton>
        )}
        {p.extra}
      </div>
      <div className="flex items-center gap-3">
        {p.onPanel && (
          <Button variant="ghost" className="gap-2 text-xs" onClick={p.onPanel}>
            {p.onClosePanel && <X className="size-14px" />}
            <span>{p.onClosePanel ? "Закрыть" : "Сводки и чат"}</span>
          </Button>
        )}
        <span className="hidden font-mono text-xs text-neutral-600 md:inline">docker · self-hosted</span>
        <Button
          onClick={p.onLeave}
          variant="ghost"
          aria-label="Выйти"
          className="gap-2 border-destructive/60 text-danger-300 hover:bg-foreground/7 hover:text-danger-300"
        >
          <SignOut />
          <span className="hidden sm:inline">Выйти</span>
        </Button>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  active,
  activeClass,
  disabled,
  label,
  className,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className={cn(active ? cn(activeClass, "h-9 w-9") : cn("h-9 w-9 text-primary"), className)}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
