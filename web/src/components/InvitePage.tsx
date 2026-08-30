import { useEffect, useState } from "react";
import { ArrowRight, Microphone, MicrophoneSlash, Plugs, UserCirclePlus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { fetchInviteInfo, joinInvite, type InviteInfo, type Session } from "@/lib/api";
import { avatarUrl } from "@/lib/avatars";
import { cn } from "@/lib/utils";

// Намерение «войти с микрофоном» — те же ключи, что у LoginPage: RoomPage
// читает их при коннекте, гость попадает в комнату с включённым микрофоном.
const LS_MIC = "iris.login.mic";

// Русская плюрализация: 1 человек, 2 человека, 5 человек, 21 человек.
function peoplePlural(n: number): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return "человек";
  if (m >= 2 && m <= 4 && (h < 12 || h > 14)) return "человека";
  return "человек";
}

// InvitePage — урезанный экран входа: комната и личность предопределены
// ссылкой, остались сводка («вы такой-то, войдёте туда-то»), микрофон и вход.
export function InvitePage({ token, onLogin }: { token: string; onLogin: (s: Session) => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  // Ссылка мертва (404/410) — показываем причину и всё, кнопок нет.
  const [dead, setDead] = useState("");
  // Сервер не ответил — «пробуем снова», опрос продолжается.
  const [offline, setOffline] = useState(false);
  const [micOn, setMicOn] = useState(() => localStorage.getItem(LS_MIC) === "1");
  const [micAvailable, setMicAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [badJoin, setBadJoin] = useState(false);

  // Живой опрос: счётчик людей и метка записи обновляются, пока человек
  // стоит на странице. 404/410 — ссылка мертва, опрос останавливается.
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const data = await fetchInviteInfo(token);
        if (stopped) return;
        setInfo(data);
        setOffline(false);
      } catch (e) {
        if (stopped) return;
        const msg = e instanceof Error ? e.message : "";
        // Мёртвой ссылку делают только 404/410; 429/502 — транзиент, опрос продолжается.
        if (msg === "инвайт не найден или отозван" || msg === "инвайт истёк") setDead(msg);
        else setOffline(true);
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [token]);

  // Доступность микрофона: без устройства кнопка серая, как на экране входа.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      if (!alive) return;
      setMicAvailable(list.some((d) => d.kind === "audioinput"));
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);

  const toggleMic = async () => {
    if (micOn) {
      setMicOn(false);
      localStorage.removeItem(LS_MIC);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicOn(true);
      localStorage.setItem(LS_MIC, "1");
    } catch {
      // Разрешение не дали — остаёмся выключенными.
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setBadJoin(false);
    try {
      onLogin(await joinInvite(token));
    } catch {
      setBadJoin(true);
    } finally {
      setBusy(false);
    }
  };

  // «Вы уже в комнате» — предупреждение, не запрет (как «логин уже в комнате»
  // на экране входа): LiveKit пускает второй сеанс, появится дубль-плитка.
  const alreadyInRoom = info != null && info.participants.some((p) => p.identity === info.identity);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-login max-w-full space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="Iris" className="size-6" />
            <h1 className="text-sm leading-none font-medium">Iris</h1>
          </div>
          <span className="font-mono text-xs tracking-mono text-neutral-600 uppercase">{window.location.hostname}</span>
        </header>

        {dead ? (
          // Ссылка недействительна или истекла: причина от сервера, без кнопок.
          <div className="flex flex-col items-center gap-3 rounded-sm border border-border bg-card px-6 py-8 text-center">
            <UserCirclePlus size={28} className="text-neutral-600" />
            <h2 className="text-xl font-medium tracking-title">Ссылка не работает</h2>
            <p className="text-sm text-neutral-500">{dead}</p>
            <p className="text-xs text-neutral-600">Попросите новый инвайт у кого-нибудь в комнате.</p>
          </div>
        ) : !info ? (
          // Первый ответ ещё не пришёл: offline — «сервер не отвечает», иначе
          // короткая пауза загрузки (бэкенд отвечает быстро, лоадер не нужен).
          <div className="flex items-center gap-2 rounded-sm bg-background px-3 py-2 shadow-sm">
            <Plugs size={15} className="flex-none text-warn" />
            <span className="text-xs text-neutral-500">
              {offline ? "Сервер не отвечает, пробуем снова…" : "Загружаем приглашение…"}
            </span>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {/* Блок 1: кто ты и куда идёшь */}
            <div className="flex items-center gap-4 rounded-sm border border-border bg-card p-5">
              <img
                src={avatarUrl(info.identity, info.avatar_seed)}
                alt={info.name}
                className="size-16 flex-none rounded-full border object-cover"
              />
              <div className="min-w-0">
                <h2 className="truncate text-xl font-medium tracking-title">{info.name}</h2>
                <p className="mt-0.5 text-sm text-neutral-400">
                  войдёте в «{info.room_display}»<span className="mx-1.5 text-neutral-700">·</span>
                  {info.participants.length > 0 ? (
                    <span>
                      {info.participants.length} {peoplePlural(info.participants.length)} в комнате
                    </span>
                  ) : (
                    <span className="text-neutral-600">пока пусто</span>
                  )}
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  {info.recording && (
                    <span className="flex items-center gap-1.5 font-mono text-xs tracking-mono text-recording uppercase">
                      <span className="size-1.25 animate-rec rounded-full bg-recording" />
                      идёт запись
                    </span>
                  )}
                </div>
              </div>
            </div>

            {alreadyInRoom && <p className="text-xs text-warn">Вы уже в комнате — второй вход покажет вас дважды.</p>}

            {/* Блок 2: микрофон — с чем войти */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void toggleMic()}
                aria-pressed={micOn}
                title="Микрофон"
                disabled={!micAvailable}
                className={cn(
                  "flex size-9 flex-none items-center justify-center rounded-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50",
                  micOn
                    ? "border-primary text-primary"
                    : "border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300",
                )}
              >
                {micOn ? <Microphone size={15} weight="fill" /> : <MicrophoneSlash size={15} />}
              </button>
              <span className="text-xs text-neutral-600">{micOn ? "микрофон включён" : "микрофон выключен"}</span>
            </div>

            {/* Блок 3: вход */}
            <Button
              type="submit"
              variant="outline"
              className="flex w-full items-center justify-center gap-2"
              disabled={busy || offline}
            >
              <span className="truncate">{busy ? "Входим…" : `Войти в «${info.room_display}»`}</span>
              <ArrowRight size={15} className="flex-none" />
            </Button>
            {badJoin && (
              <p className="text-xs text-danger-300">Не удалось войти. Ссылка, возможно, уже недействительна.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
