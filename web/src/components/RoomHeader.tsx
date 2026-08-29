import { ChatTeardropText, MonitorArrowUp, Sparkle } from '@phosphor-icons/react'
import { formatClock } from '@/lib/names'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

// Статус связи в шапке: точка + текст. Приоритет: сервер недоступен важнее
// переподключения LiveKit (обычно они падают вместе).
function statusBadge(
  connState: ConnState,
  backendOnline: boolean,
): { text: string; tone: keyof typeof tones } {
  if (!backendOnline) return { text: 'нет связи с сервером', tone: 'bad' }
  switch (connState) {
    case 'reconnecting':
      return { text: 'переподключение…', tone: 'warn' }
    case 'connecting':
      return { text: 'подключение…', tone: 'warn' }
    case 'disconnected':
      return { text: 'связь потеряна', tone: 'bad' }
    default:
      return { text: 'онлайн', tone: 'ok' }
  }
}

const tones = {
  ok: { text: 'text-ai-300', border: '[border-color:oklch(0.72_0.1_195/0.5)]', dot: 'bg-ai-400' },
  warn: { text: 'text-warn', border: '[border-color:oklch(0.62_0.13_75/0.55)]', dot: 'bg-warn' },
  bad: { text: 'text-recording', border: '[border-color:oklch(0.55_0.17_25/0.55)]', dot: 'bg-recording' },
} as const

export function RoomHeader({
  count,
  elapsed,
  recording,
  secretary,
  screenLabel,
  connState,
  backendOnline,
  onOpenPanel,
  panelBtnClass,
}: {
  count: number
  elapsed: number
  recording: boolean
  secretary: boolean
  screenLabel?: string
  connState: ConnState
  backendOnline: boolean
  onOpenPanel?: () => void
  // Где прятать кнопку: комната — панель видна от lg, stage/summaries — от xl.
  panelBtnClass?: string
}) {
  const status = statusBadge(connState, backendOnline)
  const tone = tones[status.tone]
  return (
    <header className="flex flex-none items-center justify-between gap-6 border-b border-border bg-card px-6 py-3">
      <div className="flex min-w-0 items-center gap-4">
        <img src="/logo.svg" alt="Iris" className="h-6 w-6 flex-none" />
        <span className="text-[14px] font-medium">Iris · общая комната</span>
        <span className="font-mono text-[11px] text-neutral-600">
          {count} в комнате · {formatClock(elapsed)}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] max-sm:border-0 max-sm:p-0',
            tone.text,
            tone.border,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />
          <span className="max-sm:hidden">{status.text}</span>
        </div>
        {recording && (
          <div className="flex items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[oklch(0.75_0.14_25)] [border-color:oklch(0.62_0.16_25/0.55)] max-sm:border-0 max-sm:p-0">
            <span className="h-1.5 w-1.5 animate-rec rounded-full bg-recording" />
            <span className="max-sm:hidden">запись</span>
          </div>
        )}
        {secretary && (
          <div className="flex items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ai-300 [border-color:oklch(0.72_0.1_195/0.5)] max-sm:border-0 max-sm:p-0">
            <Sparkle className="h-3 w-3" />
            <span className="max-sm:hidden">секретарь</span>
          </div>
        )}
        {screenLabel && (
          <div className="flex items-center gap-2 rounded-full border border-accent-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent-300 max-lg:hidden">
            <MonitorArrowUp className="h-3 w-3" />
            <span className="max-sm:hidden">{screenLabel}</span>
          </div>
        )}
        {onOpenPanel && (
          <Button
            variant="ghost"
            aria-label="Сводки и чат"
            title="Сводки и чат"
            className={cn('h-8 w-8 p-0', panelBtnClass ?? 'min-lg:hidden')}
            onClick={onOpenPanel}
          >
            <ChatTeardropText className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  )
}