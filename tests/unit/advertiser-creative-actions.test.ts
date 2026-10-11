import { beforeEach, describe, expect, it, vi } from "vitest";

// The surface is behind a FEATURE_* flag (lib/features.ts); on here, and off
// in the tests that check the refusal.
const feature = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/features", () => ({
  featureEnabled: () => feature.on,
  FEATURE_OFF_ERROR: "This part of the portal isn't available yet.",
}));

// Authoring a creative and submitting it for operator review (docs/plans/30 §5):
// who may do it, what lands in the DB (atomically), and that the operator email
// is a side-effect that never undoes a recorded submission (CLAUDE.md §3.2).

type Write = { op: "insert" | "update"; table: unknown; values: Record<string, unknown> };

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  member: true,
  // Rows for the top-level db.select(...).limit() (advertiser / creative lookup).
  top: [] as unknown[],
  // Rows for the in-transaction campaign lookup.
  campaign: [] as unknown[],
  reviewers: [] as { email: string }[] | Error,
  // Committed writes only: the fake transaction buffers and drops them on throw.
  writes: [] as Write[],
  failInsertOn: null as unknown,
  emptyReturningOn: null as unknown,
  // The guarded status flip matches no row: the creative changed underneath.
  statusChanged: false,
  email: vi.fn((_to: string, _p: unknown) => Promise.resolve()),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/advertiser-roles", () => ({ isAdvertiserMember: () => Promise.resolve(h.member) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/email/send", () => ({ sendAdCreativePendingReviewEmail: h.email }));
vi.mock("@/lib/email/links", () => ({ portalUrl: (p: string) => `https://portal.test${p}` }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.limit = () => Promise.resolve(rows());
    return c;
  };
  const makeTx = (buf: Write[]) => ({
    select: () => chain(() => h.campaign),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === h.failInsertOn) throw new Error("insert failed");
        buf.push({ op: "insert", table, values });
        const rows = table === h.emptyReturningOn ? [] : [{ id: "new-id" }];
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(rows) });
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (!h.statusChanged) buf.push({ op: "update", table, values });
          return Object.assign(Promise.resolve(), {
            returning: () => Promise.resolve(h.statusChanged ? [] : [{ id: "c1" }]),
          });
        },
      }),
    }),
  });
  return {
    db: {
      select: () => chain(() => h.top),
      selectDistinct: () => {
        const c: Record<string, unknown> = {};
        c.from = () => c;
        c.innerJoin = () => c;
        c.where = () => (h.reviewers instanceof Error ? Promise.reject(h.reviewers) : Promise.resolve(h.reviewers));
        return c;
      },
      // Commit on success, discard on throw — the rollback a real transaction gives.
      transaction: async <T>(cb: (t: ReturnType<typeof makeTx>) => Promise<T>): Promise<T> => {
        const buf: Write[] = [];
        const out = await cb(makeTx(buf));
        h.writes.push(...buf);
        return out;
      },
    },
  };
});

import { createCreativeAction } from "@/app/(portal)/advertiser/[advertiserId]/creatives/new/actions";
import { submitCreativeForReviewAction } from "@/app/(portal)/advertiser/[advertiserId]/creatives/[creativeId]/actions";
import { adCampaigns, adCreatives, adCreativeStatusLog } from "@/lib/db/schema";

const form = (o: Record<string, string> = {}) => {
  const fd = new FormData();
  const base = { campaignName: "Winter", slot: "post_checkin", headline: "New beacons", body: "In stock now.", altText: "Beacons", targetKind: "national", ...o };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
};

const creativeRow = (o: Record<string, unknown> = {}) => ({
  status: "draft",
  headline: "New beacons",
  advertiserId: "adv1",
  advertiserName: "Demo Outfitters",
  advertiserStatus: "active",
  ...o,
});

const submit = () => submitCreativeForReviewAction("adv1", "c1", null, new FormData());

beforeEach(() => {
  vi.clearAllMocks();
  feature.on = true;
  h.actor = { ok: true, userId: "u1" };
  h.statusChanged = false;
  h.member = true;
  h.top = [];
  h.campaign = [{ id: "camp1" }];
  h.reviewers = [{ email: "admin@rmdig.test" }, { email: "reviewer@rmdig.test" }];
  h.writes = [];
  h.failInsertOn = null;
  h.emptyReturningOn = null;
});

describe("createCreativeAction", () => {
  beforeEach(() => {
    h.top = [{ status: "active" }];
  });

  it("refuses while the advertiser portal is switched off", async () => {
    feature.on = false;
    expect(await createCreativeAction("adv1", null, form())).toEqual({ ok: false, error: "This part of the portal isn't available yet." });
    expect(h.writes).toEqual([]);
  });

  it("files a draft creative under an existing campaign of the same name", async () => {
    expect(await createCreativeAction("adv1", null, form({ clickUrl: "https://shop.example/beacons" }))).toEqual({ ok: true, creativeId: "new-id" });
    expect(h.writes).toHaveLength(1);
    const [w] = h.writes;
    expect(w?.table).toBe(adCreatives);
    expect(w?.values).toMatchObject({
      campaignId: "camp1",
      slot: "post_checkin",
      headline: "New beacons",
      body: "In stock now.",
      altText: "Beacons",
      clickUrl: "https://shop.example/beacons",
      targetKind: "national",
    });
    // Status is left to the DB default ('draft'): authoring never self-approves.
    expect(w?.values).not.toHaveProperty("status");
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.creative.created", creativeId: "new-id" }));
  });

  it("creates the campaign in the same transaction when the name is new", async () => {
    h.campaign = [];
    expect(await createCreativeAction("adv1", null, form({ campaignName: "Spring" }))).toEqual({ ok: true, creativeId: "new-id" });
    expect(h.writes.map((w) => w.table)).toEqual([adCampaigns, adCreatives]);
    expect(h.writes[0]?.values).toEqual({ advertiserId: "adv1", name: "Spring" });
    expect(h.writes[1]?.values).toMatchObject({ campaignId: "new-id" });
  });

  it("refuses a signed-out caller and a non-member, writing nothing", async () => {
    h.actor = { ok: false, error: "Sign in again." };
    expect(await createCreativeAction("adv1", null, form())).toEqual({ ok: false, error: "Sign in again." });
    h.actor = { ok: true, userId: "u1" };
    h.member = false;
    expect(await createCreativeAction("adv1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/don't have access/) });
    expect(h.writes).toEqual([]);
  });

  it("refuses a missing or suspended advertiser account, writing nothing", async () => {
    h.top = [];
    expect(await createCreativeAction("adv1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    h.top = [{ status: "suspended" }];
    expect(await createCreativeAction("adv1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/suspended/) });
    expect(h.writes).toEqual([]);
  });

  it("returns field errors for bad content, an http link, or bad targeting, writing nothing", async () => {
    expect(await createCreativeAction("adv1", null, form({ headline: "" }))).toMatchObject({ ok: false, fieldErrors: { headline: expect.any(Array) } });
    expect(await createCreativeAction("adv1", null, form({ clickUrl: "http://shop.example" }))).toMatchObject({ ok: false, fieldErrors: { clickUrl: expect.any(Array) } });
    // loading_idle is in the DB enum but reserved — not buyable.
    expect(await createCreativeAction("adv1", null, form({ slot: "loading_idle" }))).toMatchObject({ ok: false, fieldErrors: { slot: expect.any(Array) } });
    expect(await createCreativeAction("adv1", null, form({ targetKind: "radius", targetLat: "999", targetLon: "-105", targetRadiusMi: "10" }))).toMatchObject({ ok: false, fieldErrors: { target: expect.any(Array) } });
    expect(h.writes).toEqual([]);
  });

  it("fails loud and leaves no orphan campaign when the creative insert fails", async () => {
    h.campaign = [];
    h.failInsertOn = adCreatives;
    expect(await createCreativeAction("adv1", null, form())).toEqual({ ok: false, error: "Couldn't save the ad. Try again in a moment." });
    expect(h.writes).toEqual([]);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.creative.create_failed", advertiserId: "adv1", err: expect.any(Error) }));
    expect(h.log.info).not.toHaveBeenCalled();
  });

  it("fails loud when an insert returns no row", async () => {
    for (const table of [adCampaigns, adCreatives]) {
      h.campaign = [];
      h.emptyReturningOn = table;
      expect(await createCreativeAction("adv1", null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    }
    expect(h.writes).toEqual([]);
    expect(h.log.error).toHaveBeenCalledTimes(2);
  });
});

describe("submitCreativeForReviewAction", () => {
  beforeEach(() => {
    h.top = [creativeRow()];
  });

  it("refuses while the advertiser portal is switched off", async () => {
    feature.on = false;
    expect(await submit()).toEqual({ ok: false, error: "This part of the portal isn't available yet." });
    expect(h.writes).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("moves a draft to pending, logs the transition, emails each reviewer and revalidates", async () => {
    expect(await submit()).toEqual({ ok: true });
    expect(h.writes).toHaveLength(2);
    expect(h.writes[0]).toMatchObject({ op: "update", table: adCreatives, values: { status: "pending", reviewNote: null, submittedAt: expect.any(Date) } });
    expect(h.writes[1]).toMatchObject({
      op: "insert",
      table: adCreativeStatusLog,
      values: { creativeId: "c1", action: "submitted", fromStatus: "draft", toStatus: "pending", actorUserId: "u1" },
    });
    const params = { advertiserName: "Demo Outfitters", headline: "New beacons", reviewUrl: "https://portal.test/admin/ad-approvals" };
    expect(h.email.mock.calls).toEqual([
      ["admin@rmdig.test", params],
      ["reviewer@rmdig.test", params],
    ]);
    expect(h.revalidate).toHaveBeenCalledWith("/advertiser/adv1/creatives/c1");
    expect(h.revalidate).toHaveBeenCalledWith("/advertiser/adv1/creatives");
  });

  it("resubmits a rejected creative, logging rejected → pending", async () => {
    h.top = [creativeRow({ status: "rejected" })];
    expect(await submit()).toEqual({ ok: true });
    expect(h.writes[1]?.values).toMatchObject({ fromStatus: "rejected", toStatus: "pending" });
  });

  it("refuses a signed-out caller and a non-member, writing and emailing nothing", async () => {
    h.actor = { ok: false, error: "Sign in again." };
    expect(await submit()).toEqual({ ok: false, error: "Sign in again." });
    h.actor = { ok: true, userId: "u1" };
    h.member = false;
    expect(await submit()).toMatchObject({ ok: false, error: expect.stringMatching(/don't have access/) });
    expect(h.writes).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("refuses a missing creative, another advertiser's creative, and a suspended account", async () => {
    h.top = [];
    expect(await submit()).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    // A member of adv1 can't submit adv2's creative by swapping the bound id.
    h.top = [creativeRow({ advertiserId: "adv2" })];
    expect(await submit()).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    h.top = [creativeRow({ advertiserStatus: "suspended" })];
    expect(await submit()).toMatchObject({ ok: false, error: expect.stringMatching(/suspended/) });
    expect(h.writes).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("refuses creatives that aren't a draft or rejected", async () => {
    h.top = [creativeRow({ status: "pending" })];
    expect(await submit()).toEqual({ ok: false, error: "This ad is already under review." });
    for (const status of ["approved", "suspended"]) {
      h.top = [creativeRow({ status })];
      expect(await submit()).toEqual({ ok: false, error: `A ${status} creative can't be submitted.` });
    }
    expect(h.writes).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("fails loud and rolls back the status flip when the log insert fails", async () => {
    h.failInsertOn = adCreativeStatusLog;
    expect(await submit()).toEqual({ ok: false, error: "Couldn't submit the ad. Try again in a moment." });
    expect(h.writes).toEqual([]);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.creative.submit_failed", creativeId: "c1", err: expect.any(Error) }));
    expect(h.email).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("writes nothing when the creative's status changed after the check (a concurrent submit or review)", async () => {
    h.statusChanged = true;
    expect(await submit()).toEqual({
      ok: false,
      error: "This ad changed while you were submitting it. Reload the page and try again.",
    });
    expect(h.writes).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.creative.submit_status_changed", creativeId: "c1" }));
  });

  it("keeps the submission when one reviewer email fails, logs it, and still mails the rest", async () => {
    h.email.mockRejectedValueOnce(new Error("resend down"));
    expect(await submit()).toEqual({ ok: true });
    expect(h.writes).toHaveLength(2);
    expect(h.email).toHaveBeenCalledTimes(2);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "advertiser.creative.reviewer_email_failed", creativeId: "c1", to: "admin@rmdig.test", err: expect.any(Error) }),
    );
    expect(h.revalidate).toHaveBeenCalledTimes(2);
  });

  it("keeps the submission when the reviewer lookup fails, and logs it", async () => {
    h.reviewers = new Error("db down");
    expect(await submit()).toEqual({ ok: true });
    expect(h.writes).toHaveLength(2);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.creative.reviewer_lookup_failed", creativeId: "c1" }));
    expect(h.revalidate).toHaveBeenCalledTimes(2);
  });
});
