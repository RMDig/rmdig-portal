import { beforeEach, describe, expect, it, vi } from "vitest";

// Staff decisions on an ad creative (docs/plans/30 §5/§6): who may decide,
// what the advertiser is told, and that the email never says "in the app"
// before the creative was published.

const CREATIVE_ID = "22222222-2222-4222-8222-222222222222";
const ADVERTISER_ID = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  staff: true,
  creative: [] as unknown[],
  updates: [] as unknown[],
  publish: vi.fn(),
  unpublish: vi.fn(() => Promise.resolve()),
  email: vi.fn(() => Promise.resolve()),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ isPlatformStaff: () => Promise.resolve(h.staff) }));
vi.mock("@/lib/avserv/client", () => ({ publishCreative: h.publish, unpublishCreative: h.unpublish }));
vi.mock("@/lib/email/send", () => ({ sendAdCreativeDecisionEmail: h.email }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.innerJoin = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve(h.creative);
  const update = () => ({ set: (v: unknown) => ({ where: () => { h.updates.push(v); return Promise.resolve(); } }) });
  const tx = { update, insert: () => ({ values: () => Promise.resolve() }) };
  return { db: { select: () => sel, update, transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)) } };
});

import { reviewCreativeAction } from "@/app/(portal)/admin/ad-approvals/actions";

const row = (status: string) => ({
  id: CREATIVE_ID,
  status,
  headline: "Wax up",
  body: "Tune-ups this week.",
  altText: "A ski",
  clickUrl: null,
  slot: "post_checkin",
  avservCreativeRef: status === "approved" ? "ref-1" : null,
  targetKind: "national",
  targetLat: null,
  targetLon: null,
  targetRadiusMi: null,
  targetAdminLevel: null,
  targetAdminFips: null,
  advertiserName: "Demo Outfitters",
  advertiserEmail: "ads@demo.co",
  advertiserId: ADVERTISER_ID,
});

function fd(decision: string, note?: string): FormData {
  const f = new FormData();
  f.set("creativeId", CREATIVE_ID);
  f.set("decision", decision);
  if (note !== undefined) f.set("note", note);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "staff-1" };
  h.staff = true;
  h.updates = [];
  h.publish.mockResolvedValue({ avservCreativeRef: "ref-new" });
});

describe("reviewCreativeAction", () => {
  it("refuses anyone who isn't staff, and a session without two-factor", async () => {
    h.staff = false;
    h.creative = [row("pending")];
    expect(await reviewCreativeAction(null, fd("approve"))).toMatchObject({ ok: false });
    h.actor = { ok: false, error: "Set up two-factor authentication first." };
    expect(await reviewCreativeAction(null, fd("approve"))).toEqual({ ok: false, error: "Set up two-factor authentication first." });
    expect(h.email).not.toHaveBeenCalled();
  });

  it("emails an approval as published, with a link to the creative, once it reached the app", async () => {
    h.creative = [row("pending")];
    expect(await reviewCreativeAction(null, fd("approve"))).toEqual({ ok: true });
    expect(h.email).toHaveBeenCalledWith("ads@demo.co", expect.objectContaining({
      decision: "approved",
      published: true,
      creativeUrl: expect.stringMatching(new RegExp(`/advertiser/${ADVERTISER_ID}/creatives/${CREATIVE_ID}$`)),
    }));
  });

  it("never tells the advertiser it's in the app when publishing failed", async () => {
    h.creative = [row("pending")];
    h.publish.mockRejectedValue(new Error("avserv down"));
    expect(await reviewCreativeAction(null, fd("approve"))).toEqual({ ok: true });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "ad.publish.failed" }));
    expect(h.email).toHaveBeenCalledWith("ads@demo.co", expect.objectContaining({ decision: "approved", published: false }));
  });

  it("links a change request to the edit page", async () => {
    h.creative = [row("pending")];
    await reviewCreativeAction(null, fd("request_changes", "Shorter headline, please."));
    expect(h.email).toHaveBeenCalledWith("ads@demo.co", expect.objectContaining({
      decision: "changes_requested",
      note: "Shorter headline, please.",
      creativeUrl: expect.stringMatching(/\/edit$/),
    }));
  });

  it("tells the advertiser when their ad is suspended, with staff's note, after pulling it", async () => {
    h.creative = [row("approved")];
    expect(await reviewCreativeAction(null, fd("suspend", "The link is broken."))).toEqual({ ok: true });
    expect(h.unpublish).toHaveBeenCalledWith("ref-1");
    expect(h.email).toHaveBeenCalledWith("ads@demo.co", expect.objectContaining({ decision: "suspended", note: "The link is broken." }));
  });

  it("sends nothing on reactivate, which only returns the ad to review", async () => {
    h.creative = [row("suspended")];
    expect(await reviewCreativeAction(null, fd("reactivate"))).toEqual({ ok: true });
    expect(h.email).not.toHaveBeenCalled();
  });

  it("keeps the decision when the email fails, and logs it", async () => {
    h.creative = [row("approved")];
    h.email.mockRejectedValueOnce(new Error("resend down"));
    expect(await reviewCreativeAction(null, fd("suspend"))).toEqual({ ok: true });
    expect(h.updates[0]).toMatchObject({ status: "suspended" });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "ad.review.email_failed" }));
  });
});
