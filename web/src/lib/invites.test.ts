import { expect, test } from "bun:test";
import { inviteSeats, type InviteSeat } from "./invites";

const NOW = Date.parse("2024-01-01T00:00:00Z");
const inv = (token: string, expiresAt: string): InviteSeat["inv"] => ({
  token,
  name: "Гость",
  created_at: "",
  expires_at: expiresAt,
});
const ids = (...tokens: string[]) => new Set(tokens.map((t) => `inv-${t}`));

test("живой гость держит кресло даже после протухания инвайта", () => {
  const expired = inv("dead", "2020-01-01T00:00:00Z");
  expect(inviteSeats([expired], ids("dead"), NOW)).toHaveLength(1);
});

test("протухший инвайт без гостя уходит из сетки", () => {
  const expired = inv("dead", "2020-01-01T00:00:00Z");
  expect(inviteSeats([expired], ids(), NOW)).toHaveLength(0);
});

test("живой инвайт без гостя ждёт как «кресло»", () => {
  const alive = inv("live", "2099-01-01T00:00:00Z");
  const seats = inviteSeats([alive], ids(), NOW);
  expect(seats).toHaveLength(1);
  expect(seats[0].id).toBe("inv-live");
  expect(seats[0].live).toBe(false);
});
