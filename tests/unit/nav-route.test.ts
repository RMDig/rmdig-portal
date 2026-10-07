import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/nav: the public pages' header asks it who's signed in (CLAUDE.md §3.7
// keeps auth out of those pages). Never cached; a failure is logged and the
// header stays signed out.

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string; email?: string } } | null,
  rows: { roles: [] as string[], teams: [] as unknown[], advertisers: [] as unknown[] },
  fail: false,
  logError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.session) }));
vi.mock("@/lib/logger", () => ({ logger: { error: h.logError, info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/auth/roles", () => ({
  getPlatformRoles: () => (h.fail ? Promise.reject(new Error("db down")) : Promise.resolve(h.rows.roles)),
}));
vi.mock("@/lib/db", () => {
  let call = 0;
  const chain = (): Record<string, unknown> => {
    const which = call++ % 2 === 0 ? "teams" : "advertisers";
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(h.rows[which]);
    return c;
  };
  return { db: { select: () => chain() } };
});

import { GET } from "@/app/api/nav/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.rows = { roles: [], teams: [], advertisers: [] };
  h.fail = false;
});

describe("GET /api/nav", () => {
  it("answers signed out with no viewer, uncached", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ viewer: null });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("shows Map only to someone with a team, an advertiser account or a staff role", async () => {
    h.session = { user: { id: "u1", email: "a@b.co" } };
    expect(await (await GET()).json()).toEqual({ viewer: { email: "a@b.co", isStaff: false, hasMap: false } });
    h.rows.teams = [{ id: "t" }];
    expect((await (await GET()).json()).viewer).toMatchObject({ hasMap: true, isStaff: false });
    h.rows = { roles: ["rmdig_reviewer"], teams: [], advertisers: [] };
    expect((await (await GET()).json()).viewer).toMatchObject({ hasMap: true, isStaff: true });
  });

  it("fails loud (logged, 500) and lets the header fall back to signed out", async () => {
    h.session = { user: { id: "u1", email: "a@b.co" } };
    h.fail = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect(h.logError).toHaveBeenCalledWith(expect.objectContaining({ event: "nav.viewer_failed", userId: "u1" }));
  });
});
