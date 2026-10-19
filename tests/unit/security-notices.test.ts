import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  sent: [] as Array<{ to: string; whenText: string }>,
  sendFails: false,
  feeds: [] as unknown[],
  feedCalls: [] as Array<Map<string, string | null> | undefined>,
  reported: [] as string[],
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { users: fakeTable("users"), securityNoticeCursors: fakeTable("security_notice_cursors") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("@/lib/email/send", () => ({
  sendSecurityNoticeEmail: (to: string, p: { whenText: string }) => {
    if (h.sendFails) return Promise.reject(new Error("resend down"));
    h.sent.push({ to, whenText: p.whenText });
    return Promise.resolve();
  },
}));
vi.mock("@/lib/email/links", () => ({ portalUrl: (p: string) => `https://rmdig.ai${p}` }));
vi.mock("@/lib/avserv/security-events", () => ({
  NOTICES_READER: "portal-user:automation:security-notices",
  readFeeds: (_a: string, _r: string, cursors?: Map<string, string | null>) => {
    h.feedCalls.push(cursors);
    return Promise.resolve(h.feeds);
  },
}));
vi.mock("@/lib/report-error", () => ({ reportError: (event: string) => h.reported.push(event) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { notifySecurityChange, runSecurityNotices, setSecurityNotices } from "@/lib/auth/security-notices";
import { createFakeDb } from "./helpers/fake-db";

const ON = new Date("2026-10-18T09:00:00Z");
const feed = (node: string, events: Array<{ id: string; kind: string; at: string }>, cursor = "c-end") => ({
  ok: true,
  feed: { node, events: events.map((e) => ({ ...e, deviceId: "d" })), cursor, truncated: false },
});

beforeEach(() => {
  h.fake = createFakeDb();
  h.sent = [];
  h.sendFails = false;
  h.feeds = [];
  h.feedCalls = [];
  h.reported = [];
  h.fake.rows("users").push(
    { id: "on", email: "on@example.com", securityNoticesAt: ON, avservAccountId: "acct-on" },
    { id: "off", email: "off@example.com", securityNoticesAt: null, avservAccountId: "acct-off" },
  );
});

describe("notifySecurityChange", () => {
  it("emails only an opted-in user, with no detail of what changed", async () => {
    await notifySecurityChange("off");
    expect(h.sent).toEqual([]);
    await notifySecurityChange("on", new Date("2026-10-18T18:30:00Z"));
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.to).toBe("on@example.com");
  });

  it("reports a failed email and never throws into the change it announces", async () => {
    h.sendFails = true;
    await expect(notifySecurityChange("on")).resolves.toBeUndefined();
    expect(h.reported).toEqual(["security_notices.notify_failed"]);
  });
});

describe("setSecurityNotices", () => {
  it("turning on starts every answering node at the end of its feed", async () => {
    h.feeds = [feed("avserv-2", [], "end-2"), { ok: false, node: "avserv-3", code: "unreachable" }];
    await setSecurityNotices("off", "acct-off", true);
    expect(h.fake!.rows("users").find((u) => u.id === "off")!.securityNoticesAt).toBeInstanceOf(Date);
    expect(h.fake!.rows("security_notice_cursors")).toEqual([{ userId: "off", node: "avserv-2", cursor: "end-2" }]);
  });

  it("turning off clears the switch and the cursors", async () => {
    h.fake!.rows("security_notice_cursors").push({ userId: "on", node: "avserv-2", cursor: "x" });
    await setSecurityNotices("on", "acct-on", false);
    expect(h.fake!.rows("users").find((u) => u.id === "on")!.securityNoticesAt).toBeNull();
    expect(h.fake!.rows("security_notice_cursors")).toEqual([]);
  });
});

describe("runSecurityNotices", () => {
  const NOW = new Date("2026-10-19T17:00:00Z");

  it("sends one notice for new events since the last read, and moves the cursors on", async () => {
    h.fake!.rows("security_notice_cursors").push({ userId: "on", node: "avserv-2", cursor: "c1", updatedAt: new Date("2026-10-18T17:00:00Z") });
    h.feeds = [feed("avserv-2", [{ id: "a", kind: "contact_remove", at: "2026-10-19T08:00:00Z" }, { id: "b", kind: "revoke", at: "2026-10-19T09:00:00Z" }], "c2")];
    expect(await runSecurityNotices(NOW)).toEqual({ users: 1, notified: 1, failed: 0 });
    expect(h.sent).toHaveLength(1);
    expect(h.feedCalls[0]).toEqual(new Map([["avserv-2", "c1"]]));
    expect(h.fake!.rows("security_notice_cursors")).toEqual([{ userId: "on", node: "avserv-2", cursor: "c2", updatedAt: NOW }]);
  });

  it("doesn't announce a re-read event, one from before notices were on, or an unknown kind", async () => {
    h.feeds = [
      feed("avserv-2", [
        { id: "old", kind: "register", at: "2026-10-01T00:00:00Z" },
        { id: "odd", kind: "mystery", at: "2026-10-19T08:00:00Z" },
      ]),
    ];
    expect(await runSecurityNotices(NOW)).toMatchObject({ notified: 0, failed: 0 });
    expect(h.sent).toEqual([]);
  });

  it("leaves the cursors where they were when the email fails, so tomorrow retries", async () => {
    h.fake!.rows("security_notice_cursors").push({ userId: "on", node: "avserv-2", cursor: "c1", updatedAt: new Date("2026-10-18T17:00:00Z") });
    h.feeds = [feed("avserv-2", [{ id: "a", kind: "contact_add", at: "2026-10-19T08:00:00Z" }], "c2")];
    h.sendFails = true;
    expect(await runSecurityNotices(NOW)).toMatchObject({ notified: 0, failed: 1 });
    expect(h.fake!.rows("security_notice_cursors")[0]!.cursor).toBe("c1");
    expect(h.reported).toEqual(["security_notices.user_failed"]);
  });
});
