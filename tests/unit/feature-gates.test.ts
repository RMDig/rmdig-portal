import { beforeEach, describe, expect, it, vi } from "vitest";

// Surfaces waiting on AvServ endpoints are off by default (lib/features.ts):
// every server action behind them refuses before reading the session or the
// database, so a stale form or a hand-made POST can't reach a dead route.

const h = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  touched: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/auth", () => ({
  auth: () => {
    h.touched("auth");
    return Promise.resolve(null);
  },
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth/portal-actor", () => ({
  portalActor: () => {
    h.touched("portalActor");
    return Promise.resolve({ ok: false, error: "signed out" });
  },
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => h.touched("db") }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

import { featureEnabled, FEATURE_OFF_ERROR } from "@/lib/features";
import { createAdvertiserAccountAction } from "@/app/(portal)/advertiser/new/actions";
import { createAdvertiserInvitationAction } from "@/app/(portal)/advertiser/[advertiserId]/members/actions";
import { createCreativeAction } from "@/app/(portal)/advertiser/[advertiserId]/creatives/new/actions";
import { submitCreativeForReviewAction } from "@/app/(portal)/advertiser/[advertiserId]/creatives/[creativeId]/actions";
import { publishApprovedCreativeAction } from "@/app/(portal)/admin/ad-approvals/actions";
import { acceptAdvertiserInvitationAction } from "@/app/advertiser-invite/[token]/actions";

const OFF = { ok: false, error: FEATURE_OFF_ERROR };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(h.env)) delete h.env[k];
});

describe("featureEnabled", () => {
  it("is off unless the flag says exactly \"on\" (unset, \"off\", or the raw build-time env)", () => {
    expect(featureEnabled("advertiser_portal")).toBe(false);
    h.env.FEATURE_ADVERTISER_PORTAL = "off";
    expect(featureEnabled("advertiser_portal")).toBe(false);
    h.env.FEATURE_ADVERTISER_PORTAL = "true";
    expect(featureEnabled("advertiser_portal")).toBe(false);
    h.env.FEATURE_ADVERTISER_PORTAL = "on";
    expect(featureEnabled("advertiser_portal")).toBe(true);
    expect(featureEnabled("restriction_review")).toBe(false);
    h.env.FEATURE_RESTRICTION_REVIEW = "on";
    expect(featureEnabled("restriction_review")).toBe(true);
  });
});

describe("advertiser actions while the advertiser portal is off", () => {
  it("each refuses before touching the session or the database", async () => {
    const fd = new FormData();
    expect(await createAdvertiserAccountAction(null, fd)).toEqual(OFF);
    expect(await createAdvertiserInvitationAction("a", null, fd)).toEqual(OFF);
    expect(await createCreativeAction("a", null, fd)).toEqual(OFF);
    expect(await submitCreativeForReviewAction("a", "c", null, fd)).toEqual(OFF);
    expect(await publishApprovedCreativeAction("c", null, fd)).toEqual(OFF);
    expect(await acceptAdvertiserInvitationAction("token", null, fd)).toEqual(OFF);
    expect(h.touched).not.toHaveBeenCalled();
  });
});
