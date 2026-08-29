import { useEffect, useState } from "react";

// Доступность бэкенда: лёгкий опрос /api/healthz. Нужен для статуса в шапке —
// опросы данных (room, recordings) молчат при падении (catch {}), а
// пользователь должен видеть, что сервер недоступен. Стартуем как «онлайн»,
// чтобы не мигать при первом рендере.
export function useBackendStatus(intervalMs = 10_000): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/healthz");
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void check();
    const t = setInterval(check, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return online;
}
