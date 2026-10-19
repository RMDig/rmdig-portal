import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mergeFeeds } from "@/lib/avserv/security-events-merge";

// security_events.md rev 1: dedupe on the action's id keeping the earliest
// `at`, drop unknown kinds with a count only, read every node with a reader.

const h = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: () => Promise.resolve("jwt"), deviceAdminKeyConfigured: () => false }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const ev = (id: string, kind: string, at: string) => ({ id, kind, at, deviceId: "d-1" });

describe("mergeFeeds", () => {
  it("keeps one row per action, with the earliest time, newest first", () => {
    const m = mergeFeeds([
      [ev("a", "register", "2026-10-18T10:00:05Z"), ev("b", "contact_add", "2026-10-18T11:00:00Z")],
      [ev("a", "register", "2026-10-18T10:00:00Z")],
    ]);
    expect(m.events.map((e) => [e.id, e.at])).toEqual([
      ["b", "2026-10-18T11:00:00Z"],
      ["a", "2026-10-18T10:00:00Z"],
    ]);
  });

  it("drops a kind it doesn't know and counts it", () => {
    const m = mergeFeeds([[ev("a", "register", "t1"), ev("x", "brand_new_kind", "t2")]]);
    expect(m.events.map((e) => e.id)).toEqual(["a"]);
    expect(m.unknownDropped).toBe(1);
  });
});

const ACCT = "11111111-1111-5111-8111-111111111111";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  calls = [];
  process.env.AVSERV_BASE_URL = "https://avserv-2.example";
  process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-3.example";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AVSERV_FAILOVER_BASE_URL;
});

function stub(answer: (url: URL) => Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const a = answer(new URL(url));
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }),
  );
}

describe("readSecurityEvents (real path)", () => {
  it("reads every node with the reader header, pages by cursor, and merges", async () => {
    stub((u) => {
      const cursor = u.searchParams.get("cursor");
      const node = u.host;
      if (!cursor) return json(200, { accountId: ACCT, node, events: [ev("a", "register", "2026-10-18T10:00:00Z")], nextCursor: "c1" });
      return json(200, { accountId: ACCT, node, events: [], nextCursor: null });
    });
    const { readSecurityEvents } = await import("@/lib/avserv/security-events");
    const feed = await readSecurityEvents(ACCT, "u1");
    expect(feed).toMatchObject({ incomplete: false, failed: false });
    expect(feed.events.map((e) => e.id)).toEqual(["a"]);
    expect(new Set(calls.map((c) => new URL(c.url).host))).toEqual(new Set(["avserv-2.example", "avserv-3.example"]));
    for (const c of calls) expect((c.init.headers as Record<string, string>)["x-avai-reader"]).toBe("portal-user:u1");
  });

  it("logs a dropped unknown kind as a count, never by name", async () => {
    stub((u) =>
      u.searchParams.get("cursor")
        ? json(200, { accountId: ACCT, node: u.host, events: [], nextCursor: null })
        : json(200, { accountId: ACCT, node: u.host, events: [ev("x", "mystery_kind", "t")], nextCursor: "c" }),
    );
    const { readSecurityEvents } = await import("@/lib/avserv/security-events");
    await readSecurityEvents(ACCT, "u1");
    expect(h.log.warn).toHaveBeenCalledWith({ event: "security_events.unknown_kind_dropped", count: 2 });
    expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain("mystery_kind");
  });

  it("is incomplete with a node down, and failed with none", async () => {
    stub((u) => (u.host === "avserv-3.example" ? new TypeError("down") : json(200, { accountId: ACCT, node: u.host, events: [], nextCursor: null })));
    const a = await import("@/lib/avserv/security-events");
    expect(await a.readSecurityEvents(ACCT, "u1")).toMatchObject({ incomplete: true, failed: false });
    vi.resetModules();
    stub(() => new TypeError("down"));
    const b = await import("@/lib/avserv/security-events");
    expect(await b.readSecurityEvents(ACCT, "u1")).toMatchObject({ failed: true });
  });
});

describe("readFeeds (mock path)", () => {
  it("lists the mock phones' events and ends at a cursor that reads nothing new", async () => {
    process.env.AVSERV_BASE_URL = "mock://localhost";
    delete process.env.AVSERV_FAILOVER_BASE_URL;
    const { readFeeds } = await import("@/lib/avserv/security-events");
    const [first] = await readFeeds(ACCT, "portal-user:u1");
    expect(first?.ok && first.feed.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["register", "link", "contact_add"]));
    const cursor = first?.ok ? first.feed.cursor : null;
    const [again] = await readFeeds(ACCT, "portal-user:u1", new Map([["mock", cursor]]));
    expect(again?.ok && again.feed.events).toEqual([]);
  });
});
