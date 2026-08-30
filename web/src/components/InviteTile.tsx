import { useEffect, useState } from "react";
import { Check, Copy, Hourglass, MicrophoneSlash, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { avatarSize } from "@/components/ParticipantTile";
import { avatarUrl } from "@/lib/avatars";
import { cn } from "@/lib/utils";

// Плитка-«кресло» гостя (редизайн инвайтов, см. RoomPage): два состояния.
// draft — имя ещё не введено (плитка локальная, чужие клиенты её не видят);
// waiting — инвайт создан, ждём гостя (плитка общая для сотрудников комнаты).
// Когда гость входит, RoomPage рендерит на этом же ключе (inv-<token>) живого
// участника — плитка морфит, не двигаясь в сетке.
export function InviteTile({
  mode,
  name,
  seed,
  width,
  shake = 0,
  copied = false,
  onCreate,
  onCopy,
  onRevoke,
}: {
  mode: "draft" | "waiting";
  name?: string;
  // seed аватара: у waiting = "inv-<token>" — тот же, что у гостя в комнате,
  // морф незаметен. У draft — временный, до создания инвайта токена нет.
  seed: string;
  width?: number;
  // Тик тряски: попытка создать вторую плитку, пока эта не заведена (Q7a).
  shake?: number;
  copied?: boolean;
  onCreate?: (name: string) => void;
  onCopy?: () => void;
  onRevoke?: () => void;
}) {
  const [draftName, setDraftName] = useState("");
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 500);
    return () => clearTimeout(t);
  }, [shake]);

  // «Создать приглашение» оживает от двух символов имени.
  const ready = draftName.trim().length >= 2;

  return (
    <div
      style={width ? { width: `${width}px` } : undefined}
      className={cn(
        "group @container relative aspect-video w-full max-w-full overflow-hidden rounded-md bg-card shadow-sm sm:max-w-[50cqw]",
        "flex flex-col items-center justify-center gap-2 p-3",
        shaking && "animate-shake",
      )}
    >
      {/* identity = seed: у waiting это inv-<token>, как у гостя в комнате —
          аватар морфа не меняется. У draft токена ещё нет — временный seed. */}
      <img
        src={avatarUrl(seed, seed)}
        alt=""
        className={cn(avatarSize, "flex-none animate-breathe rounded-full bg-secondary object-cover grayscale")}
      />
      {mode === "draft" ? (
        <form
          className="flex w-full max-w-56 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && onCreate) onCreate(draftName);
          }}
        >
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Введите имя"
            maxLength={40}
            autoFocus
            className={cn("min-w-0 flex-1 text-xs", shaking && "border-danger-300")}
          />
          <Button
            type="submit"
            disabled={!ready}
            aria-label="Создать приглашение"
            title="Создать приглашение"
            className="size-8 px-0"
          >
            <Check />
          </Button>
        </form>
      ) : (
        <span className="max-w-full truncate text-sm font-medium">{name}</span>
      )}
      <div className="flex h-3 items-center gap-2">
        <MicrophoneSlash className="size-14px text-neutral-600" />
      </div>
      {mode === "waiting" && (
        <div className="flex h-3 items-center gap-2">
          <Hourglass className="size-14px text-neutral-500" />
          <span className="font-mono text-xs text-neutral-500">Ожидаем участника…</span>
          <button
            type="button"
            onClick={onCopy}
            aria-label="Скопировать ссылку-приглашение"
            title="Скопировать ссылку-приглашение"
            className="flex size-6 flex-none items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-foreground/7 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
          </button>
        </div>
      )}
      {onRevoke && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label="Удалить приглашение"
          title="Удалить приглашение — будущие входы перестанут работать"
          className="absolute top-2 right-2 z-10 flex size-6 flex-none items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-foreground/7 hover:text-danger-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:opacity-0 md:group-hover:opacity-100"
        >
          <Trash size={13} />
        </button>
      )}
    </div>
  );
}
