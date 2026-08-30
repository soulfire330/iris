import { useEffect, useState } from "react";
import { Check, Copy, Trash, UserPlus, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInvite, fetchInvites, revokeInvite, type InviteMeta } from "@/lib/api";
import { cn } from "@/lib/utils";

// Пресеты TTL (радио-баттоны). Потолок — 30 дней, бесконечных инвайтов нет;
// сервер режет ttl_sec > 2592000, пресеты лишь удобство выбора.
const TTL_PRESETS = [
  { label: "1 час", sec: 3600 },
  { label: "1 день", sec: 86_400 },
  { label: "7 дней", sec: 7 * 86_400 },
  { label: "30 дней", sec: 30 * 86_400 },
];

// Остаток жизни инвайта: «истёк», «осталось 45 мин», «2 ч», «3 дн».
function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "истёк";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `осталось ${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `осталось ${h} ч`;
  return `осталось ${Math.floor(h / 24)} дн`;
}

export function InviteModal({ open, room, onClose }: { open: boolean; room: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [ttlSec, setTtlSec] = useState(TTL_PRESETS[1].sec);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<InviteMeta[]>([]);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  // Список живых инвайтов комнаты — при каждом открытии (свежие остатки TTL).
  useEffect(() => {
    if (!open) return;
    setError("");
    fetchInvites(room)
      .then(setInvites)
      .catch((e) => setError(e instanceof Error ? e.message : "не удалось загрузить инвайты"));
  }, [open, room]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const inv = await createInvite(room, name.trim(), ttlSec);
      setInvites((cur) => [...cur, inv]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "не удалось создать инвайт");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied((cur) => (cur === token ? "" : cur)), 1500);
    } catch {
      // Буфер обмена недоступен (не-HTTP) — ссылку можно скопировать руками
      // из адресной строки после перехода; подсказок не добавляем.
    }
  };

  const revoke = async (token: string) => {
    setError("");
    try {
      await revokeInvite(room, token);
      setInvites((cur) => cur.filter((i) => i.token !== token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "не удалось отозвать инвайт");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Пригласить по ссылке"
    >
      <div
        className="max-h-[85vh] w-login max-w-full space-y-5 overflow-y-auto rounded-md border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <UserPlus size={16} className="text-primary" />
            Пригласить по ссылке
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="flex size-7 items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-foreground/7 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X size={15} />
          </button>
        </header>

        {/* Создание: имя гостя + срок жизни */}
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name" className="text-xs text-muted-foreground">
              Имя гостя
            </Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Как показывать в комнате"
              maxLength={40}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ссылка действует</Label>
            <div className="flex flex-wrap gap-1.5">
              {TTL_PRESETS.map((p) => (
                <button
                  key={p.sec}
                  type="button"
                  onClick={() => setTtlSec(p.sec)}
                  aria-pressed={ttlSec === p.sec}
                  className={cn(
                    "rounded-sm border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                    ttlSec === p.sec
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            {busy ? "Создаём…" : "Создать ссылку"}
          </Button>
        </form>

        {error && <p className="text-xs text-danger-300">{error}</p>}

        {/* Живые инвайты комнаты: все, не только свои — чужой «забытый» можно отозвать */}
        {invites.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Активные ссылки</Label>
            {invites.map((inv) => (
              <div key={inv.token} className="flex items-center gap-2 rounded-sm border border-neutral-800 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{inv.name}</p>
                  <p className="font-mono text-xs tracking-mono text-neutral-500">{remaining(inv.expires_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copy(inv.token)}
                  aria-label="Скопировать ссылку"
                  title="Скопировать ссылку"
                  className="flex size-7 flex-none items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-foreground/7 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {copied === inv.token ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void revoke(inv.token)}
                  aria-label="Отозвать ссылку"
                  title="Отозвать — будущие входы перестанут работать"
                  className="flex size-7 flex-none items-center justify-center rounded-sm text-neutral-500 transition-colors hover:bg-foreground/7 hover:text-danger-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
