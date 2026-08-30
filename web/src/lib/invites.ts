import type { InviteMeta } from "@/lib/api";

// «Кресло» гостя — плитка в сетке комнаты (редизайн инвайтов, см. RoomPage):
// живой гость или живой инвайт. Протухший инвайт без гостя из сетки уходит
// (решение Q2a); гость, вышедший при живом инвайте, оставляет кресло ждать
// (решение Q5a).
export interface InviteSeat {
  inv: InviteMeta;
  id: string; // identity гостя в LiveKit: inv-<token> (тот же, что у сервера)
  live: boolean; // гость сейчас в комнате — кресло морфит в живую плитку
}

export function inviteSeats(invites: InviteMeta[], memberIds: ReadonlySet<string>, nowMs: number): InviteSeat[] {
  return invites
    .map((inv) => {
      const id = `inv-${inv.token}`;
      return { inv, id, live: memberIds.has(id) };
    })
    .filter((s) => s.live || new Date(s.inv.expires_at).getTime() > nowMs);
}
