import { CaretDown, CaretUp, ChatTeardropText, DownloadSimple, FileText, PaperPlaneRight, Sparkle } from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
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

  // «Вчера, 10:00» — день относительно сегодня (Сегодня/Вчера/дд.мм.гг) и время.
  const formatRecDay = (iso: string) => {
    const d = new Date(iso)
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000)
    const day =
      days <= 0
        ? 'Сегодня'
        : days === 1
          ? 'Вчера'
          : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
    return `${day}, ${time}`
  }

  // «54 мин · 6» — длительность и число участников; чего нет — пропускаем.
  const recMetaLine = (r: RecordingFile) => {
    const parts: string[] = []
    if (r.stopped_at) {
      const min = Math.max(
        1,
        Math.round((new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime()) / 60_000),
      )
      parts.push(`${min} мин`)
    }
    if ((r.participants?.length ?? 0) > 0) parts.push(String(r.participants.length))
    return parts.join(' · ')
  }

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
                Прошлые встречи
              </span>
              {recordings.length === 0 ? (
                <p className="text-[12px] leading-relaxed text-neutral-500">
                  {recording
                    ? 'Запись идёт — файл появится в списке после остановки.'
                    : 'Записей пока нет — нажмите кнопку записи в панели звонка.'}
                </p>
              ) : (
                <>
                  {/* Текущая запись в список не попадает, пока egress пишет файл —
                      список прошлых встреч при этом не прячем. */}
                  {recording && (
                    <p className="text-[12px] leading-relaxed text-neutral-500">
                      Идёт запись — появится в списке после остановки.
                    </p>
                  )}
                  {recordings.map((r) => (
                    <div key={r.name} className="flex flex-col gap-1.5">
                      {/* Запись — не карточка: строка списка. Дата слева, справа —
                          длительность · участники и скачивание. */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-medium">
                          {formatRecDay(r.started_at)}
                        </span>
                        <div className="flex flex-none items-center gap-2.5">
                          {recMetaLine(r) && (
                            <span className="font-mono text-[10px] text-neutral-500">
                              {recMetaLine(r)}
                            </span>
                          )}
                          <a
                            href={`/api/recordings/${encodeURIComponent(r.name)}`}
                            download
                            title="Скачать"
                            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-foreground/5 hover:text-foreground"
                          >
                            <DownloadSimple className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                      {/* AI-сводка: статус и текст пишет воркер-секретарь в
                          {имя}.summary.json, бэкенд отдаёт в списке. */}
                      {r.summary && (
                        <SummaryBlock status={r.ai_status} error={r.ai_error} text={r.summary_text} />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-neutral-500">
              Кнопка AI в панели звонка — при идущей записи — закажет сводку: секретарь
              распознает речь и пришлёт краткий пересказ сюда. Обычная запись — только аудиофайл.
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

// Сводка AI: вертикальная AI-полоса слева определяет блок; заголовок с иконкой,
// тело — markdown от LLM (react-markdown, стили .md-body), свёрнуто до двух
// строк, клик по заголовку разворачивает. Нет AI-заказа — блока нет вовсе.
function SummaryBlock({ status, error, text }: { status: string; error: string; text: string }) {
  const [open, setOpen] = useState(false)
  const bar = <div className="w-px flex-none self-stretch bg-ai" aria-hidden />
  const title = (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ai-300">
      <Sparkle className="h-3 w-3" />
      <span>Сводка</span>
    </span>
  )
  if (status !== 'done') {
    return (
      <div className="flex gap-2.5">
        {bar}
        <div className="min-w-0 flex-1">
          {title}
          <div className="mt-1 text-[11px] leading-relaxed">
            {status === 'error' ? (
              <span className="text-warn">не удалась: {error}</span>
            ) : (
              <span className="text-neutral-500">готовится…</span>
            )}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      {bar}
      <div className="min-w-0 flex-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ai-300 transition-colors hover:text-ai-400"
          aria-expanded={open}
        >
          <Sparkle className="h-3 w-3" />
          <span>Сводка</span>
          {open ? <CaretUp className="h-3 w-3" /> : <CaretDown className="h-3 w-3" />}
        </button>
        <div className={cn('mt-1', !open && 'line-clamp-2')}>
          {text ? (
            <div className="md-body">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-500">Сводка пуста — в записи не было речи.</p>
          )}
        </div>
      </div>
    </div>
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
