import { beforeEach, describe, expect, it, vi } from "vitest";

// The layout's read: one query when nothing is live; memberships only when
// something is, then filtered to the viewer's audiences.

const h = vi.hoisted(() => ({ selects: [] as unknown[][], calls: 0 }));

vi.mock("@/lib/db", () => {
  function chain() {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) c[m] = () => c;
    c.limit = () => {
      h.calls++;
      return Promise.resolve(h.selects.shift() ?? []);
    };
    return c;
  }
  return { db: { select: () => chain() } };
});

import { announcementsFor } from "@/lib/announcements/queries";

const row = (id: string, audiences: string[]) => ({ id, message: id, severity: "info", audiences, endsAt: null });

beforeEach(() => {
  h.selects = [];
  h.calls = 0;
});

describe("announcementsFor", () => {
  it("costs one query when nothing is live", async () => {
    await expect(announcementsFor("u1", false)).resolves.toEqual([]);
    expect(h.calls).toBe(1);
  });

  it("filters live announcements to the viewer's audiences", async () => {
    h.selects = [[row("all", ["everyone"]), row("sar", ["sar"]), row("ads", ["advertiser"])], [{ u: "u1" }], []];
    const got = await announcementsFor("u1", false);
    expect(got.map((a) => a.id)).toEqual(["all", "sar"]);
  });

  it("shows explorer-only notices to a user with no roles, and not to staff", async () => {
    h.selects = [[row("exp", ["explorer"])], [], []];
    expect((await announcementsFor("u1", false)).map((a) => a.id)).toEqual(["exp"]);
    h.selects = [[row("exp", ["explorer"])], [], []];
    expect(await announcementsFor("u2", true)).toEqual([]);
  });
});
