import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/sar/oncall-confirm.ts: what a link would confirm, and confirming it
// once, under a row lock (plan 33 9.10).

const h = vi.hoisted(() => ({
  row: [] as unknown[],
  updates: [] as unknown[],
  locked: false,
}));
vi.mock("@/lib/db", () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.for = () => {
      h.locked = true;
      return c;
    };
    c.limit = () => Promise.resolve(h.row);
    return c;
  };
  const tx = {
    select: () => chain(),
    update: () => ({ set: (v: unknown) => ({ where: () => { h.updates.push(v); return Promise.resolve(); } }) }),
  };
  return { db: { select: () => chain(), transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});

import { confirmOncallLink, ONCALL_LINK_PROBLEM, readOncallLink } from "@/lib/sar/oncall-confirm";

const TOKEN = "b".repeat(64);
const NOW = new Date("2026-11-11T12:00:00Z");
const row = (o: Record<string, unknown> = {}) => ({
  id: "v1",
  orgId: "org-1",
  address: "dispatch@summitrescue.org",
  expires: new Date("2026-11-12T00:00:00Z"),
  confirmedAt: null,
  teamName: "Summit SAR",
  status: "approved",
  isDrill: false,
  ...o,
});

beforeEach(() => {
  h.row = [];
  h.updates = [];
  h.locked = false;
});

describe("readOncallLink", () => {
  it("shows what an open link would confirm, and changes nothing", async () => {
    h.row = [row()];
    expect(await readOncallLink(TOKEN, NOW)).toEqual({ ok: true, verificationId: "v1", orgId: "org-1", teamName: "Summit SAR", address: "dispatch@summitrescue.org", isDrill: false });
    expect(h.updates).toEqual([]);
  });

  it("refuses a malformed, unknown, used or expired link, and a closed team", async () => {
    expect(await readOncallLink("short", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await readOncallLink(TOKEN, NOW)).toEqual({ ok: false, reason: "invalid" });
    h.row = [row({ confirmedAt: new Date("2026-11-11T11:00:00Z") })];
    expect(await readOncallLink(TOKEN, NOW)).toEqual({ ok: false, reason: "used" });
    h.row = [row({ expires: NOW })];
    expect(await readOncallLink(TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
    h.row = [row({ status: "withdrawn" })];
    expect(await readOncallLink(TOKEN, NOW)).toEqual({ ok: false, reason: "team_closed" });
    for (const reason of ["invalid", "used", "expired", "team_closed"] as const) expect(ONCALL_LINK_PROBLEM[reason]).toBeTruthy();
  });
});

describe("confirmOncallLink", () => {
  it("sets the team's address and marks the link used, under a row lock", async () => {
    h.row = [row()];
    expect(await confirmOncallLink(TOKEN, NOW)).toMatchObject({ ok: true, orgId: "org-1" });
    expect(h.locked).toBe(true);
    expect(h.updates).toEqual([{ oncallEmail: "dispatch@summitrescue.org", oncallEmailVerifiedAt: NOW }, { confirmedAt: NOW }]);
  });

  it("changes nothing for a link that's used, expired or for a closed team", async () => {
    for (const o of [{ confirmedAt: NOW }, { expires: NOW }, { status: "suspended" }]) {
      h.row = [row(o)];
      expect(await confirmOncallLink(TOKEN, NOW)).toMatchObject({ ok: false });
    }
    expect(h.updates).toEqual([]);
  });
});
