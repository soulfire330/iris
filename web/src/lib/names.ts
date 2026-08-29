// Инициалы из имени: «Иван Иванов» → «ИИ».
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Тающий таймер встречи: 1:42:07.
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

// Метаданные участника от бэкенда: { "seed": "...", "role": "backend" }.
export interface Meta {
  seed?: string;
  role?: string;
}

export function parseMeta(raw?: string | null): Meta {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? (j as Meta) : {};
  } catch {
    return {};
  }
}
