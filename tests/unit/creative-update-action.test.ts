import { beforeEach, describe, expect, it, vi } from "vitest";

// Editing a creative: only a draft or one sent back for changes, only by a
// member of its advertiser, through the same validation as creating it.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  member: true,
  row: [] as unknown[],
  campaign: [] as unknown[],
  updates: [] as unknown[],
  inserted: [] as unknown[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/advertiser-roles", () => ({ isAdvertiserMember: () => Promise.resolve(h.member) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.limit = () => Promise.resolve(rows());
    return c;
  };
  const tx = {
    select: () => chain(() => h.campaign),
    insert: () => ({ values: (v: unknown) => ({ returning: () => (h.inserted.push(v), Promise.resolve([{ id: "camp-new" }])) }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => (h.updates.push(v), Promise.resolve()) }) }),
  };
  return { db: { select: () => chain(() => h.row), transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});

import { updateCreativeAction } from "@/app/(portal)/advertiser/[advertiserId]/creatives/[creativeId]/edit/actions";
import { creativeStatusLabel } from "@/lib/advertiser/creative-status";

const form = (o: Record<string, string> = {}) => {
  const fd = new FormData();
  const base = { campaignName: "Winter", slot: "post_checkin", headline: "New beacons", body: "In stock now.", altText: "Beacons", targetKind: "national", ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "u1" };
  h.member = true;
  h.row = [{ status: "draft", advertiserId: "adv1", advertiserStatus: "active" }];
  h.campaign = [{ id: "camp1" }];
  h.updates = [];
  h.inserted = [];
});

describe("updateCreativeAction", () => {
  it("saves a draft or sent-back creative's new content and targeting", async () => {
    expect(await updateCreativeAction("adv1", "c1", null, form())).toEqual({ ok: true, creativeId: "c1" });
    expect(h.updates[0]).toMatchObject({ campaignId: "camp1", headline: "New beacons", targetKind: "national" });
    h.row = [{ status: "rejected", advertiserId: "adv1", advertiserStatus: "active" }];
    h.campaign = [];
    expect(await updateCreativeAction("adv1", "c1", null, form({ campaignName: "Spring" }))).toEqual({ ok: true, creativeId: "c1" });
    expect(h.inserted[0]).toMatchObject({ advertiserId: "adv1", name: "Spring" });
  });

  it("refuses approved, pending and suspended creatives: what was approved is what ships", async () => {
    for (const status of ["approved", "pending", "suspended"]) {
      h.row = [{ status, advertiserId: "adv1", advertiserStatus: "active" }];
      expect(await updateCreativeAction("adv1", "c1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/Only a draft/) });
    }
    expect(h.updates).toEqual([]);
  });

  it("refuses non-members, another advertiser's creative, and a suspended account", async () => {
    h.member = false;
    expect((await updateCreativeAction("adv1", "c1", null, form())).ok).toBe(false);
    h.member = true;
    h.row = [{ status: "draft", advertiserId: "adv2", advertiserStatus: "active" }];
    expect(await updateCreativeAction("adv1", "c1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    h.row = [{ status: "draft", advertiserId: "adv1", advertiserStatus: "suspended" }];
    expect(await updateCreativeAction("adv1", "c1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/suspended/) });
    expect(h.updates).toEqual([]);
  });

  it("returns field errors from the shared validation", async () => {
    const r = await updateCreativeAction("adv1", "c1", null, form({ headline: "" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { headline: expect.any(Array) } });
  });
});

describe("creativeStatusLabel", () => {
  it("calls a draft with a reviewer note 'Changes requested'", () => {
    expect(creativeStatusLabel("draft", "Shorten the headline")).toBe("Changes requested");
    expect(creativeStatusLabel("draft", null)).toBe("Draft");
    expect(creativeStatusLabel("rejected", "No")).toBe("Not approved");
  });
});
