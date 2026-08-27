import { ChatTeardropText, FileText, Sparkle } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Правая колонка секретаря. Сводки и чат придут с эпиком AI-секретаря;
// сейчас — каркас по дизайну с честными пустыми данными.
export function SecretaryPanel() {
  const [tab, setTab] = useState<'summaries' | 'chat'>('summaries')

  return (
    <aside className="flex h-full min-h-0 w-[300px] flex-col border-l border-border bg-card">
      <div className="flex flex-none border-b border-border">
        <TabButton active={tab === 'summaries'} onClick={() => setTab('summaries')}>
          <Sparkle className="h-[13px] w-[13px] text-ai" />
          <span>Сводки</span>
        </TabButton>
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
          <ChatTeardropText className="h-[13px] w-[13px]" />
          <span>Чат</span>
        </TabButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {tab === 'summaries' ? (
          <>
            <p className="text-[12px] leading-relaxed text-neutral-500">
              Секретарь пишет встречу и присылает сводку в чат комнаты после того, как вышел
              последний участник. По ходу разговора он молчит.
            </p>
            <div className="flex flex-col gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-600">
                прошлые встречи
              </span>
            </div>
            <Button variant="ghost" disabled className="mt-auto w-full gap-2 text-[12px]">
              <FileText className="h-[14px] w-[14px]" />
              <span>Все сводки</span>
            </Button>
          </>
        ) : (
          <p className="text-[12px] leading-relaxed text-neutral-500">
            Чат комнаты появится вместе с секретарём.
          </p>
        )}
      </div>
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