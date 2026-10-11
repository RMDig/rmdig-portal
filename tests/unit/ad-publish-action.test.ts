import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Staff retry of an approved creative that isn't live yet (docs/plans/30 §9
// invariant 5): it goes to AvServ first and is stamped live only on AvServ's
// say-so, so a failure leaves it "approved, not yet live" with a retry, never a
// false "live". The real AvServ client runs against a stubbed fetch, so what is
// sent and how AvServ's answer is checked are both exercised; the DB is the
// in-memory fake (no DB, no network — CLAUDE.md §4.3).

const CREATIVE_ID = "22222222-2222-4222-8222-222222222222";
const BASE_URL = "https://avserv.test";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  env: { FEATURE_ADVERTISER_PORTAL: "on", AVSERV_BASE_URL: "https://avserv.test" } as Record<string, string | undefined>,
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  staff: true,
  canReview: vi.fn<(userId: string) => void>(),
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  revalidate: vi.fn<(path: string) => void>(),
  // The advertiser behind the creative, reached through the action's joins.
  advertiserStatus: "active" as "active" | "suspended",
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return {
    adCreatives: fakeTable("ad_creatives"),
    adCampaigns: fakeTable("ad_campaigns"),
    adCreativeStatusLog: fakeTable("ad_creative_status_log"),
    advertiserAccounts: fakeTable("advertiser_accounts"),
  };
});
// The fake DB has no joins, and its columns are bare names (advertiserAccounts.status
// and adCreatives.status would collide). The action joins creative → campaign →
// advertiser only to read the advertiser's status, so the shim keeps the creative
// query as is and answers `advertiserStatus` from h.advertiserStatus.
type Fields = Record<string, string> | undefined;
type Chain = { where: (p: unknown) => Promise<Row[]> & { limit: (n: number) => Promise<Row[]> } };
function joinable(db: Record<string, unknown>) {
  const select = db.select as (f: Fields) => { from: (t: unknown) => Chain };
  return {
    ...db,
    select: (fields: Fields) => {
      const { advertiserStatus, ...rest } = fields ?? {};
      const add = (rows: Row[]) =>
        advertiserStatus === undefined ? rows : rows.map((r) => ({ ...r, advertiserStatus: h.advertiserStatus }));
      return {
        from: (table: unknown) => {
          const inner = select(fields ? rest : undefined).from(table);
          const chain = {
            innerJoin: () => chain,
            where: (p: unknown) => {
              const q = inner.where(p);
              return Object.assign(q.then(add), { limit: (n: number) => q.limit(n).then(add) });
            },
          };
          return chain;
        },
      };
    },
  };
}
vi.mock("@/lib/db", () => ({
  get db() {
    return joinable(h.fake!.db);
  },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
// h.staff: holds rmdig_admin or rmdig_reviewer (AD_REVIEW_ROLES).
vi.mock("@/lib/auth/roles", () => ({
  canReviewAds: (userId: string) => {
    h.canReview(userId);
    return Promise.resolve(h.staff);
  },
}));
// The signer needs a real key; the request path around it is what's under test.
vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: () => Promise.resolve("svc-jwt") }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendAdCreativeDecisionEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { publishApprovedCreativeAction } from "@/app/(portal)/admin/ad-approvals/actions";
import { AvServError } from "@/lib/avserv/client";

import { createFakeDb, type Row } from "./helpers/fake-db";

const creatives = () => h.fake!.rows("ad_creatives");
const statusLog = () => h.fake!.rows("ad_creative_status_log");

function seed(overrides: Row = {}): Row {
  const row: Row = {
    id: CREATIVE_ID,
    status: "approved",
    publishedAt: null,
    avservCreativeRef: null,
    slot: "post_checkin",
    headline: "Wax up",
    body: "Tune-ups this week.",
    altText: "A ski",
    clickUrl: "https://demo.co/tune",
    targetKind: "national",
    targetLat: null,
    targetLon: null,
    targetRadiusMi: null,
    targetAdminLevel: null,
    targetAdminFips: null,
    ...overrides,
  };
  creatives().push(row);
  return row;
}

const publish = (id = CREATIVE_ID) => publishApprovedCreativeAction(id, null, new FormData());
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const RETRY_ERROR = { ok: false, error: "The ad didn't go live. Try again in a moment." };

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
  h.env.FEATURE_ADVERTISER_PORTAL = "on";
  h.actor = { ok: true, userId: "staff-1" };
  h.staff = true;
  h.advertiserStatus = "active";
  // A fresh Response per call: a body can only be read once.
  h.fetch.mockImplementation(() => Promise.resolve(json(201, { avservCreativeRef: "crv_live1" })));
  vi.stubGlobal("fetch", h.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Nothing reached AvServ and the creative is still "approved, not yet live". */
function expectUntouched(row: Row) {
  expect(h.fetch).not.toHaveBeenCalled();
  expect(row).toMatchObject({ publishedAt: null, avservCreativeRef: null });
  expect(statusLog()).toHaveLength(0);
  expect(h.revalidate).not.toHaveBeenCalled();
}

describe("publishApprovedCreativeAction: happy path", () => {
  it("sends the creative to AvServ, then stamps the returned ref and publish time", async () => {
    const row = seed();
    // Snapshot the row when AvServ is called: the code claims AvServ first, DB after.
    let atCall: Row | null = null;
    h.fetch.mockImplementationOnce(() => {
      atCall = { ...row };
      return Promise.resolve(json(201, { avservCreativeRef: "crv_live1" }));
    });
    const before = Date.now();

    expect(await publish()).toEqual({ ok: true });

    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/v1/internal/ad-creatives`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer svc-jwt", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      portalCreativeId: CREATIVE_ID,
      slot: "post_checkin",
      headline: "Wax up",
      body: "Tune-ups this week.",
      altText: "A ski",
      clickUrl: "https://demo.co/tune",
      target: { kind: "national" },
    });

    expect(atCall).toMatchObject({ publishedAt: null, avservCreativeRef: null });
    expect(row.avservCreativeRef).toBe("crv_live1");
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect((row.publishedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    // Publishing doesn't change the approval decision.
    expect(row.status).toBe("approved");
    // The code records publication on the creative row only — no audit row.
    expect(statusLog()).toHaveLength(0);

    expect(h.revalidate).toHaveBeenCalledWith("/admin/ad-approvals");
    expect(h.log.info).toHaveBeenCalledWith({ event: "ad.publish.retry_success", userId: "staff-1", creativeId: CREATIVE_ID });
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it("sends a radius target as numbers and an admin target with its FIPS list", async () => {
    seed({ targetKind: "radius", targetLat: "39.74", targetLon: "-105", targetRadiusMi: 30 });
    expect(await publish()).toEqual({ ok: true });
    expect(JSON.parse(String(h.fetch.mock.calls[0]![1].body))).toMatchObject({
      target: { kind: "radius", lat: 39.74, lon: -105, mi: 30 },
    });

    h.fake = createFakeDb();
    h.fetch.mockClear();
    seed({ targetKind: "admin", targetAdminLevel: "county", targetAdminFips: ["08013", "08049"] });
    expect(await publish()).toEqual({ ok: true });
    expect(JSON.parse(String(h.fetch.mock.calls[0]![1].body))).toMatchObject({
      target: { kind: "admin", level: "county", fips: ["08013", "08049"] },
    });
  });
});

describe("publishApprovedCreativeAction: access", () => {
  it("refuses while the advertiser portal is off, before reading the session", async () => {
    const row = seed();
    h.env.FEATURE_ADVERTISER_PORTAL = "off";
    expect(await publish()).toEqual({ ok: false, error: "This part of the portal isn't available yet." });
    expect(h.canReview).not.toHaveBeenCalled();
    expectUntouched(row);
  });

  it("refuses a signed-out caller (or one without two-factor) with the actor's error", async () => {
    const row = seed();
    h.actor = { ok: false, error: "Sign in to continue." };
    expect(await publish()).toEqual({ ok: false, error: "Sign in to continue." });
    expect(h.canReview).not.toHaveBeenCalled();
    expectUntouched(row);
  });

  it("refuses a signed-in user who isn't ad-review staff", async () => {
    const row = seed();
    h.staff = false;
    expect(await publish()).toEqual({ ok: false, error: "You don't have access to the approvals queue." });
    expect(h.canReview).toHaveBeenCalledWith("staff-1");
    expectUntouched(row);
  });
});

describe("publishApprovedCreativeAction: state guards", () => {
  it("reports an unknown creative without calling AvServ", async () => {
    const other = seed({ id: "99999999-9999-4999-8999-999999999999" });
    expect(await publish()).toEqual({ ok: false, error: "That ad no longer exists." });
    expectUntouched(other);
  });

  it.each(["draft", "pending", "rejected", "suspended"])("never publishes a %s creative", async (status) => {
    const row = seed({ status });
    expect(await publish()).toEqual({
      ok: false,
      error: `Only an approved creative can be published (this one is ${status}).`,
    });
    expectUntouched(row);
  });

  it("refuses an approved creative that's already live, leaving its stamps alone", async () => {
    const live = new Date("2026-10-01T12:00:00Z");
    const row = seed({ publishedAt: live, avservCreativeRef: "crv_old" });
    expect(await publish()).toEqual({ ok: false, error: "This ad is already live." });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(row).toMatchObject({ publishedAt: live, avservCreativeRef: "crv_old" });
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("rejects a malformed creative id before querying", async () => {
    seed();
    expect(await publish("not-a-uuid")).toEqual({ ok: false, error: "That ad no longer exists." });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refuses to publish a creative whose advertiser account is suspended", async () => {
    const row = seed();
    h.advertiserStatus = "suspended";
    expect(await publish()).toEqual({ ok: false, error: "This advertiser is suspended, so its ads can't go live." });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(row).toMatchObject({ publishedAt: null, avservCreativeRef: null });
  });
});

describe("publishApprovedCreativeAction: AvServ failures fail loud, never false-live", () => {
  // Each case: the error surfaced to staff, a loud log naming the creative, and no stamp.
  async function expectFailedLoud(row: Row, match: RegExp) {
    expect(await publish()).toEqual(RETRY_ERROR);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ad.publish.failed", creativeId: CREATIVE_ID, err: expect.any(AvServError) }),
    );
    const { err } = h.log.error.mock.calls[0]![0] as { err: Error };
    expect(err.message).toMatch(match);
    expect(row).toMatchObject({ status: "approved", publishedAt: null, avservCreativeRef: null });
    expect(h.log.info).not.toHaveBeenCalled();
    expect(h.revalidate).not.toHaveBeenCalled();
  }

  it.each([
    [500, /unexpected status 500/],
    [400, /unexpected status 400/],
    [401, /service JWT \(401\)/],
    [503, /not configured \(503\)/],
  ])("an AvServ %i", async (status, match) => {
    const row = seed();
    h.fetch.mockResolvedValueOnce(json(status, { code: "nope" }));
    await expectFailedLoud(row, match);
  });

  it("a timeout", async () => {
    const row = seed();
    h.fetch.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    );
    await expectFailedLoud(row, /failed: The operation was aborted due to timeout/);
  });

  it("an unreachable node", async () => {
    const row = seed();
    h.fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expectFailedLoud(row, /failed: fetch failed/);
  });

  it.each([
    ["a 2xx without a ref", json(200, {})],
    ["a non-string ref", json(200, { avservCreativeRef: 42 })],
    ["a body that isn't JSON", new Response("<html>ok</html>", { status: 200 })],
  ])("%s from AvServ", async (_label, res) => {
    const row = seed();
    h.fetch.mockResolvedValueOnce(res);
    await expectFailedLoud(row, /missing avservCreativeRef/);
  });

  it("can be retried: a failed attempt leaves it publishable, the next one goes live", async () => {
    const row = seed();
    h.fetch.mockResolvedValueOnce(json(502, {}));
    expect(await publish()).toEqual(RETRY_ERROR);

    expect(await publish()).toEqual({ ok: true });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(row.avservCreativeRef).toBe("crv_live1");

    // Once live, a further click is refused rather than publishing twice.
    expect(await publish()).toEqual({ ok: false, error: "This ad is already live." });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("publishApprovedCreativeAction: AvServ accepted but the portal couldn't record it", () => {
  // AvServ and the portal must agree on what's live: an ad AvServ holds but the
  // portal has no ref for could never be pulled (a later suspend has nothing to
  // unpublish). So the new ref is pulled straight back, and the creative stays
  // "approved, not live" and retryable.
  const calls = () => h.fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`);
  const failStamp = () => {
    h.fake!.db.update = () => ({
      set: () => ({
        // The action awaits only .returning(); no bare rejected promise is left unawaited.
        where: () => ({ returning: () => Promise.reject(new Error("connection terminated")) }),
      }),
    });
  };
  const answer = (...responses: Response[]) => {
    h.fetch.mockReset();
    for (const r of responses) h.fetch.mockImplementationOnce(() => Promise.resolve(r));
  };

  it("reports the ref to Sentry, pulls the ad back off AvServ, and leaves it retryable", async () => {
    const row = seed();
    failStamp();
    answer(json(201, { avservCreativeRef: "crv_live1" }), new Response(null, { status: 204 }));

    expect(await publish()).toEqual(RETRY_ERROR);
    expect(calls()).toEqual([
      `POST ${BASE_URL}/v1/internal/ad-creatives`,
      `DELETE ${BASE_URL}/v1/internal/ad-creatives/crv_live1`,
    ]);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ad.publish.record_failed", creativeId: CREATIVE_ID, avservCreativeRef: "crv_live1" }),
    );
    expect(h.log.error).not.toHaveBeenCalledWith(expect.objectContaining({ event: "ad.publish.orphaned_live" }));
    expect(row).toMatchObject({ status: "approved", publishedAt: null, avservCreativeRef: null });
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("reports an orphaned live ad, with its ref, when the pull fails too", async () => {
    seed();
    failStamp();
    answer(json(201, { avservCreativeRef: "crv_live1" }), json(500, { code: "internal" }));

    expect(await publish()).toEqual(RETRY_ERROR);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "ad.publish.orphaned_live", creativeId: CREATIVE_ID, avservCreativeRef: "crv_live1" }),
    );
  });

  it("pulls the new ref when the creative was suspended while AvServ published it", async () => {
    const row = seed();
    h.fetch.mockReset();
    h.fetch.mockImplementationOnce(() => {
      row.status = "suspended"; // a reviewer's suspend lands mid-publish
      return Promise.resolve(json(201, { avservCreativeRef: "crv_late" }));
    });
    h.fetch.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));

    expect(await publish()).toEqual({
      ok: false,
      error: "This ad changed while it was being published. Reload the page to see where it stands.",
    });
    expect(calls()[1]).toBe(`DELETE ${BASE_URL}/v1/internal/ad-creatives/crv_late`);
    expect(row).toMatchObject({ status: "suspended", publishedAt: null, avservCreativeRef: null });
  });

  it("leaves the live ad alone when another publish already recorded the same ref", async () => {
    const row = seed();
    const live = new Date("2026-10-11T12:00:00Z");
    h.fetch.mockReset();
    h.fetch.mockImplementationOnce(() => {
      Object.assign(row, { publishedAt: live, avservCreativeRef: "crv_same" }); // the other click won
      return Promise.resolve(json(201, { avservCreativeRef: "crv_same" }));
    });

    expect((await publish()).ok).toBe(false);
    expect(h.fetch).toHaveBeenCalledTimes(1); // no DELETE: that would take the live ad down
    expect(row).toMatchObject({ publishedAt: live, avservCreativeRef: "crv_same" });
  });
});
