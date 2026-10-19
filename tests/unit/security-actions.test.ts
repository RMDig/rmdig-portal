import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  recent: { ok: true, sessionId: "s1", authMethod: "password" } as { ok: true; sessionId: string; authMethod: string } | { ok: false; reauth: true },
  order: [] as string[],
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve({ ok: true, userId: "u1" }) }));
vi.mock("@/lib/auth/recent-auth", () => ({ requireRecentAuth: () => Promise.resolve(h.recent) }));
vi.mock("@/lib/auth/security-notices", () => ({
  notifySecurityChange: () => {
    h.order.push("notify");
    return Promise.resolve();
  },
  setSecurityNotices: (_u: string, _a: unknown, on: boolean) => {
    h.order.push(on ? "set-on" : "set-off");
    return Promise.resolve();
  },
}));
vi.mock("@/lib/auth/security-events", () => ({
  recordSecurityEvent: (_db: unknown, e: { kind: string }) => {
    h.order.push(`event:${e.kind}`);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db/schema", () => ({ users: {} }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ accountId: "acct" }]) }) }) }) },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { setNoticesAction } from "@/app/(portal)/settings/security/actions";

const fd = (on: string) => {
  const f = new FormData();
  f.set("on", on);
  return f;
};

beforeEach(() => {
  h.recent = { ok: true, sessionId: "s1", authMethod: "password" };
  h.order = [];
});

describe("setNoticesAction", () => {
  it("turns notices on, records it, then confirms by email", async () => {
    expect(await setNoticesAction(null, fd("1"))).toEqual({ ok: true, message: "Security notices are on." });
    expect(h.order).toEqual(["set-on", "event:notices_on", "notify"]);
  });

  it("announces turning them off BEFORE it takes effect", async () => {
    expect(await setNoticesAction(null, fd("0"))).toEqual({ ok: true, message: "Security notices are off." });
    expect(h.order).toEqual(["notify", "set-off", "event:notices_off"]);
  });

  it("needs a recent login either way, and changes nothing without it", async () => {
    h.recent = { ok: false, reauth: true };
    expect(await setNoticesAction(null, fd("0"))).toMatchObject({ ok: false, reauth: true });
    expect(h.order).toEqual([]);
  });
});
