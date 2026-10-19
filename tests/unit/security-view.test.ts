import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  portal: [] as Array<{ id: string; kind: string; at: Date }>,
  feed: { events: [] as unknown[], incomplete: false, failed: false },
  reads: 0,
}));

vi.mock("@/lib/db/schema", () => ({ accountSecurityEvents: { id: "id", kind: "kind", at: "at", userId: "user_id" } }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), desc: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(h.portal) }) }) }) }) },
}));
vi.mock("@/lib/avserv/security-events", () => ({
  readSecurityEvents: () => {
    h.reads++;
    return Promise.resolve(h.feed);
  },
}));

import { loadSecurityView } from "@/lib/auth/security-view";

beforeEach(() => {
  h.portal = [];
  h.feed = { events: [], incomplete: false, failed: false };
  h.reads = 0;
});

describe("loadSecurityView", () => {
  it("merges the portal's changes with AvServ's, newest first, phones by a short id", async () => {
    h.portal = [{ id: "p1", kind: "password_changed", at: new Date("2026-10-18T10:00:00Z") }];
    h.feed.events = [{ id: "a1", kind: "revoke", at: "2026-10-18T12:00:00Z", deviceId: "abcdef12-3456-5789-8abc-def012345678" }];
    const view = await loadSecurityView("u1", "acct");
    expect(view.rows.map((r) => [r.label, r.device])).toEqual([
      ["A phone was signed out", "abcdef12…"],
      ["Password changed", null],
    ]);
    expect(view.incomplete).toBe(false);
  });

  it("says incomplete when a server didn't answer, and skips AvServ with no linked account", async () => {
    h.feed = { events: [], incomplete: false, failed: true };
    expect((await loadSecurityView("u1", "acct")).incomplete).toBe(true);
    await loadSecurityView("u1", null);
    expect(h.reads).toBe(1);
  });
});
