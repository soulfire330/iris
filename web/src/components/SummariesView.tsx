import { SquaresFour } from "@phosphor-icons/react";
import { ParticipantsRail } from "@/components/ParticipantsRail";
import { SummaryBlock } from "@/components/SecretaryPanel";
import { formatRecDay } from "@/lib/format";
import type { RecordingFile } from "@/lib/api";
import type { Member } from "@/lib/members";

// Раскладка «Все сводки»: большой список AI-сводок для чтения, участники —
// рельсом, как при демонстрации. Панель сводок/чата — третьей колонкой в
// RoomPage. Демонстрация приоритетнее: кто-то начал шарить экран — RoomPage
// закрывает раскладку сам.
export function SummariesView({
  recordings,
  members,
  onSelect,
  onCollapse,
  callBar,
}: {
  recordings: RecordingFile[];
  members: Member[];
  onSelect: (m: Member) => void;
  onCollapse: () => void;
  callBar: React.ReactNode;
}) {
  // Только встречи с заказанной AI-сводкой; записи без сводки большому окну
  // не нужны. «Готовится…» и упавшие остаются — воркер пишет фоном, окно
  // обновляется само.
  const withSummary = recordings.filter((r) => r.summary);

  // «54 мин · Админ, Тестер» — длительность и кто был; чего нет — пропускаем.
  const meta = (r: RecordingFile) => {
    const parts: string[] = [];
    if (r.stopped_at) {
      const min = Math.max(
        1,
        Math.round((new Date(r.stopped_at).getTime() - new Date(r.started_at).getTime()) / 60_000),
      );
      parts.push(`${min} мин`);
    }
    if (r.participants.length > 0) parts.push(r.participants.join(", "));
    return parts.join(" · ");
  };

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-col gap-6 p-6">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card shadow-sm">
          {/* Возврат к общему виду конференции */}
          <button
            onClick={onCollapse}
            title="К общему виду"
            className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-neutral-100 transition-colors hover:bg-neutral-900/70"
          >
            <SquaresFour className="h-4 w-4" />
          </button>
          <div className="h-full overflow-y-auto px-6 py-5">
            {withSummary.length === 0 ? (
              <p className="text-sm leading-relaxed text-neutral-500">
                Сводок пока нет — закажите AI-сводку кнопкой AI в панели звонка при идущей записи.
              </p>
            ) : (
              <div className="flex max-w-[860px] flex-col gap-8">
                {withSummary.map((r) => (
                  <div key={r.name} className="flex flex-col gap-1.5">
                    {/* Дата встречи и «кто был · сколько» — как в табе, но с именами. */}
                    <div className="flex items-baseline gap-2">
                      <span className="flex-none text-sm font-medium">{formatRecDay(r.started_at)}</span>
                      {meta(r) && <span className="truncate text-xs text-neutral-500">{meta(r)}</span>}
                    </div>
                    <SummaryBlock large status={r.ai_status} error={r.ai_error} text={r.summary_text} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {callBar}
      </div>

      <ParticipantsRail members={members} selectedId={null} hideCameraOfSelected={false} onSelect={onSelect} />
    </>
  );
}
