import {
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  SignOut,
  VideoCamera,
  X,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface CallBarProps {
  muted: boolean
  cameraOn: boolean
  screenOn: boolean
  onMic: () => void
  onCamera: () => void
  onScreen: () => void
  onLeave: () => void
  extra?: ReactNode // «Во весь экран» для зрителей показа
  onPanel?: () => void
  onClosePanel?: () => void
}

export function CallBar(p: CallBarProps) {
  return (
    <div className="flex flex-none flex-wrap items-center justify-between gap-4 rounded-md bg-card p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <IconButton
          onClick={p.onMic}
          active={!p.muted}
          activeClass="text-primary"
          label={p.muted ? 'Включить микрофон' : 'Выключить микрофон'}
        >
          {p.muted ? <MicrophoneSlash /> : <Microphone weight="fill" />}
        </IconButton>
        <IconButton
          onClick={p.onScreen}
          active={p.screenOn}
          activeClass="text-destructive"
          label={p.screenOn ? 'Закончить демонстрацию' : 'Начать демонстрацию'}
        >
          {p.screenOn ? <X weight="bold" /> : <MonitorArrowUp />}
        </IconButton>
        <IconButton onClick={p.onCamera} active={p.cameraOn} activeClass="text-primary" label={p.cameraOn ? 'Выключить камеру' : 'Включить камеру'}>
          <VideoCamera weight={p.cameraOn ? 'fill' : 'regular'} />
        </IconButton>
        {p.extra}
      </div>
      <div className="flex items-center gap-3">
        {p.onPanel && (
          <Button variant="ghost" className="gap-2 text-[12px]" onClick={p.onPanel}>
            {p.onClosePanel && <X className="h-[14px] w-[14px]" />}
            <span>{p.onClosePanel ? 'Закрыть' : 'Сводки и чат'}</span>
          </Button>
        )}
        <span className="font-mono text-[10px] text-neutral-600">docker · self-hosted</span>
        <Button
          onClick={p.onLeave}
          variant="ghost"
          className="gap-2 border-destructive/60 text-[oklch(0.8_0.12_25)] hover:bg-[color-mix(in_oklch,var(--foreground)_7%,transparent)] hover:text-[oklch(0.8_0.12_25)]"
        >
          <SignOut />
          <span>Выйти</span>
        </Button>
      </div>
    </div>
  )
}

function IconButton({
  onClick,
  active,
  activeClass,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  activeClass?: string
  label: string
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      className={active ? cn(activeClass, 'h-9 w-9') : cn('h-9 w-9 text-primary')}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </Button>
  )
}