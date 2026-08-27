import { MonitorArrowUp, Sparkle } from '@phosphor-icons/react'
import { formatClock } from '@/lib/names'

export function RoomHeader({
  count,
  elapsed,
  recording,
  secretary,
  screenLabel,
}: {
  count: number
  elapsed: number
  recording: boolean
  secretary: boolean
  screenLabel?: string
}) {
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
        {recording && (
          <div className="flex items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[oklch(0.75_0.14_25)] [border-color:oklch(0.62_0.16_25/0.55)]">
            <span className="h-1.5 w-1.5 animate-rec rounded-full bg-recording" />
            запись
          </div>
        )}
        {secretary && (
          <div className="flex items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ai-300 [border-color:oklch(0.72_0.1_195/0.5)]">
            <Sparkle className="h-3 w-3" />
            секретарь
          </div>
        )}
        {screenLabel && (
          <div className="flex items-center gap-2 rounded-full border border-accent-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent-300">
            <MonitorArrowUp className="h-3 w-3" />
            {screenLabel}
          </div>
        )}
      </div>
    </header>
  )
}