import { beforeEach, describe, expect, it, vi } from "vitest";

// Team terms actions (docs/plans/33): org admins save and submit; rmdig admins
// publish or send back. Publishing numbers the version, hashes the exact body
// and records whether users must accept again.

const h = vi.hoisted(() => ({
  userId: "u-admin" as string | undefined,
  canManage: true,
  platformAdmin: true,
  selects: [] as unknown[][],
  updates: [] as unknown[],
  inserts: [] as unknown[],
  txError: null as unknown,
  revalidate: vi.fn(),
  pendingEmail: vi.fn(),
  decisionEmail: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const chain = () => {
    const rows = () => Promise.resolve(h.selects.shift() ?? []);
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
    c.limit = () => c;
    c.for = () => c;
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => rows().then(res, rej);
    return c;
  };
  const tx = {
    select: () => chain(),
    update: () => ({ set: (v: unknown) => ({ where: () => { h.updates.push(v); return Promise.resolve(); } }) }),
    insert: () => ({ values: (v: unknown) => { h.inserts.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select: () => chain(),
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: () => Promise.resolve(h.platformAdmin) }));
vi.mock("@/lib/email/send", () => ({ sendSarTermsPendingReviewEmail: h.pendingEmail, sendSarTermsDecisionEmail: h.decisionEmail }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { decideTermsAction } from "@/app/(portal)/admin/sar-terms/actions";
import { saveTermsAction } from "@/app/(portal)/sar/[orgId]/terms/actions";
import { termsSha256 } from "@/lib/sar/terms";

const ORG = "11111111-1111-4111-8111-111111111111";
const TERMS = "22222222-2222-4222-8222-222222222222";
const CLEAN = "We are volunteers. Call 911 first in an emergency.";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "u-admin";
  h.canManage = true;
  h.platformAdmin = true;
  h.selects = [];
  h.updates = [];
  h.inserts = [];
  h.txError = null;
});

describe("saveTermsAction", () => {
  it("saves a new draft, even with wording the check would flag", async () => {
    h.selects = [[{ name: "Summit SAR", status: "approved" }], []];
    const res = await saveTermsAction(ORG, null, fd({ body: "We respond within 30 minutes.", capabilities: ["checkout_alerts"], intent: "draft" }));
    expect(res).toEqual({ ok: true, submitted: false });
    expect(h.inserts[0]).toMatchObject({ orgId: ORG, status: "draft", capabilities: [{ name: "checkout_alerts", channels: ["portal"] }] });
    expect(h.pendingEmail).not.toHaveBeenCalled();
  });

  it("submits clean terms, updating the open draft, and emails rmdig admins", async () => {
    h.selects = [[{ name: "Summit SAR", status: "pending" }], [{ id: TERMS }], [{ email: "op@rmdig.ai" }]];
    const res = await saveTermsAction(ORG, null, fd({ body: CLEAN, capabilities: ["send_help_added", "area_map"], intent: "submit" }));
    expect(res).toEqual({ ok: true, submitted: true });
    expect(h.updates[0]).toMatchObject({ status: "submitted", submittedAt: expect.any(Date) });
    expect(h.pendingEmail).toHaveBeenCalledWith("op@rmdig.ai", expect.objectContaining({ orgName: "Summit SAR" }));
  });

  it("refuses to submit wording about response times, with the matches", async () => {
    h.selects = [[{ name: "Summit SAR", status: "approved" }]];
    const res = await saveTermsAction(ORG, null, fd({ body: "We respond within 30 minutes.", capabilities: ["checkout_alerts"], intent: "submit" }));
    expect(res).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.objectContaining({ rule: "response time" })]) });
    expect(h.inserts).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("refuses non-admins, a suspended org, and a submission with no services", async () => {
    h.canManage = false;
    expect(await saveTermsAction(ORG, null, fd({ body: CLEAN, capabilities: ["checkout_alerts"] }))).toMatchObject({ ok: false });
    h.canManage = true;
    h.selects = [[{ name: "S", status: "suspended" }]];
    expect(await saveTermsAction(ORG, null, fd({ body: CLEAN, capabilities: ["checkout_alerts"] }))).toMatchObject({ ok: false, error: expect.stringMatching(/suspended/) });
    h.selects = [[{ name: "S", status: "approved" }]];
    expect(await saveTermsAction(ORG, null, fd({ body: CLEAN, intent: "submit" }))).toMatchObject({ ok: false, fieldErrors: { capabilities: expect.any(Array) } });
  });

  it("fails loud on a database error", async () => {
    h.selects = [[{ name: "S", status: "approved" }]];
    h.txError = new Error("reset");
    expect(await saveTermsAction(ORG, null, fd({ body: CLEAN, capabilities: ["checkout_alerts"] }))).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.terms.save_failed" }));
  });
});

describe("decideTermsAction", () => {
  const cap = (name: string) => ({ name, channels: ["portal"] });
  const submittedRow = (body = CLEAN, capabilities = [cap("checkout_alerts")]) => ({
    id: TERMS,
    orgId: ORG,
    status: "submitted",
    body,
    capabilities,
    orgName: "Summit SAR",
  });

  it("publishes the first version with its hash and required re-acceptance, and emails the team's admins", async () => {
    h.selects = [[submittedRow()], [], [{ email: "lead@sar.org" }]];
    const res = await decideTermsAction(null, fd({ termsId: TERMS, decision: "publish" }));
    expect(res).toEqual({ ok: true, decision: "publish", version: 1 });
    expect(h.updates[0]).toMatchObject({ status: "published", version: 1, sha256: termsSha256(CLEAN), requiresReacceptance: true, reviewedByUserId: "u-admin" });
    expect(h.decisionEmail).toHaveBeenCalledWith("lead@sar.org", expect.objectContaining({ decision: "published", version: 1 }));
  });

  it("numbers after the latest version and carries acceptance forward when a service is only removed", async () => {
    h.selects = [
      [submittedRow(CLEAN, [cap("checkout_alerts")])],
      [{ version: 3, body: CLEAN, capabilities: [cap("checkout_alerts"), cap("send_help_added")] }],
      [],
    ];
    await decideTermsAction(null, fd({ termsId: TERMS, decision: "publish" }));
    expect(h.updates[0]).toMatchObject({ version: 4, requiresReacceptance: false });
  });

  it("won't publish flagged wording, and needs a note to send back", async () => {
    h.selects = [[submittedRow("We are on call every weekend.")]];
    expect(await decideTermsAction(null, fd({ termsId: TERMS, decision: "publish" }))).toMatchObject({ ok: false, error: expect.stringMatching(/wording check/) });
    expect(await decideTermsAction(null, fd({ termsId: TERMS, decision: "reject" }))).toMatchObject({ ok: false, error: "Say what to change." });
    expect(h.updates).toEqual([]);
  });

  it("sends back with a note", async () => {
    h.selects = [[submittedRow()], [{ email: "lead@sar.org" }]];
    expect(await decideTermsAction(null, fd({ termsId: TERMS, decision: "reject", note: "Name your county." }))).toEqual({ ok: true, decision: "reject", version: undefined });
    expect(h.updates[0]).toMatchObject({ status: "rejected", reviewNote: "Name your county." });
  });

  it("refuses non-admins and versions that aren't waiting for review", async () => {
    h.platformAdmin = false;
    expect(await decideTermsAction(null, fd({ termsId: TERMS, decision: "publish" }))).toMatchObject({ ok: false });
    h.platformAdmin = true;
    h.selects = [[{ ...submittedRow(), status: "published" }]];
    expect(await decideTermsAction(null, fd({ termsId: TERMS, decision: "publish" }))).toMatchObject({ ok: false, error: expect.stringMatching(/published/) });
  });
});
