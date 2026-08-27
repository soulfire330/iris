import { ChatTeardropText, DownloadSimple, FileText, PaperPlaneRight, Sparkle } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ChatMessage } from '@/lib/chat'
import type { RecordingFile } from '@/lib/api'
import { cn } from '@/lib/utils'

export type PanelTab = 'summaries' | 'chat'

// Правая колонка секретаря. Сводки придут с эпиком AI-секретаря; чат — живой,
// поверх data channel LiveKit (см. useChat).
export function SecretaryPanel({
  tab,
  onTabChange,
  messages,
  unread,
  connected,
  onSend,
  recordings,
  recording,
}: {
  tab: PanelTab
  onTabChange: (t: PanelTab) => void
  messages: ChatMessage[]
  unread: number
  connected: boolean
  onSend: (text: string) => void
  recordings: RecordingFile[]
  recording: boolean
}) {
  const [draft, setDraft] = useState('')
  // Обводка фокуса — только для клавиатуры: текстовый инпут всегда
  // :focus-visible, поэтому клик мыши гасит кольцо, Tab — возвращает.
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Автопрокрутка: вниз за новыми сообщениями, только пока читатель внизу —
  // не выдёргивать его из истории.
  const atBottom = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Открыли таб — вниз, к непрочитанному.
  useEffect(() => {
    if (tab === 'chat') {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [tab])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !connected) return
    onSend(text)
    setDraft('')
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  const formatRecDate = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  const formatSize = (bytes: number) =>
    bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} МБ`
      : `${Math.max(1, Math.round(bytes / 1024))} КБ`

  return (
    <aside className="flex h-full min-h-0 w-[300px] flex-col border-l border-border bg-card">
      <div className="flex flex-none border-b border-border">
        <TabButton active={tab === 'summaries'} onClick={() => onTabChange('summaries')}>
          <Sparkle className="h-[13px] w-[13px] text-ai" />
          <span>Сводки</span>
        </TabButton>
        <TabButton active={tab === 'chat'} onClick={() => onTabChange('chat')}>
          <ChatTeardropText className="h-[13px] w-[13px]" />
          <span>Чат</span>
          {unread > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-200 px-1 font-mono text-[9px] leading-none text-accent-800">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </TabButton>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-6 p-4',
          tab === 'summaries' && 'overflow-y-auto',
        )}
      >
        {tab === 'summaries' ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-600">
                записи звонков
              </span>
              {recording ? (
                <p className="text-[12px] leading-relaxed text-neutral-500">
                  Запись идёт — файл появится в списке после остановки.
                </p>
              ) : recordings.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-neutral-500">
                  Записей пока нет — нажмите кнопку записи в панели звонка.
                </p>
              ) : (
                recordings.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[12px] font-medium">{formatRecDate(r.started_at)}</span>
                      <span className="truncate font-mono text-[10px] text-neutral-500">
                        {r.started_by}
                        {(r.participants?.length ?? 0) > 0 && ` · ${r.participants.join(', ')}`}
                        {' · '}
                        {formatSize(r.size)}
                      </span>
                    </div>
                    <a
                      href={`/api/recordings/${encodeURIComponent(r.name)}`}
                      download
                      title="Скачать"
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-foreground/5 hover:text-foreground"
                    >
                      <DownloadSimple className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ))
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-neutral-500">
              Секретарь пишет встречу и присылает сводку в чат комнаты после того, как вышел
              последний участник. По ходу разговора он молчит.
            </p>
            <Button variant="ghost" disabled className="mt-auto w-full gap-2 text-[12px]">
              <FileText className="h-[14px] w-[14px]" />
              <span>Все сводки</span>
            </Button>
          </>
        ) : (
          <div
            ref={listRef}
            onScroll={() => {
              const el = listRef.current
              if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            }}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          >
            {messages.length === 0 && (
              <p className="text-[12px] leading-relaxed text-neutral-500">
                Сообщений пока нет — напишите первым.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-foreground">{m.name}</span>
                  <span className="font-mono text-[10px] text-neutral-600">{formatTime(m.ts)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-neutral-300">
                  {m.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Футер чата: геометрия повторяет панель звонка слева (p-3 + h-9,
          снизу 24px), поэтому разделитель ложится вровень с её верхом. */}
      {tab === 'chat' && (
        <div className="flex flex-none flex-col border-t border-border pb-6">
          <form onSubmit={submit} className="flex flex-none items-center gap-2 px-4 py-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPointerDown={() => setKeyboardFocus(false)}
              onKeyDown={(e) => {
                if (e.key === 'Tab') setKeyboardFocus(true)
              }}
              disabled={!connected}
              placeholder={connected ? 'Сообщение…' : 'Нет соединения'}
              className={cn(
                'h-9 min-w-0 flex-1 border-transparent bg-transparent px-0 text-[13px]',
                !keyboardFocus && 'focus-visible:outline-none',
              )}
            />
            <Button
              type="submit"
              variant="ghost"
              aria-label="Отправить"
              title="Отправить"
              className="h-9 w-9 flex-none px-0"
              disabled={!connected || !draft.trim()}
            >
              <PaperPlaneRight className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </aside>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 border-b py-3 text-[12px] transition-colors',
        active
          ? 'border-ai font-medium text-foreground'
          : 'border-transparent text-neutral-500 hover:text-neutral-300',
      )}
    >
      {children}
    </button>
  )
}
