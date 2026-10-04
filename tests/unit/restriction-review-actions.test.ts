import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvServContractError } from "@/lib/avserv/request";
import type { Restriction } from "@/lib/avserv/restrictions-types";

// Both W2 server actions (docs/plans/32): the user's review request and the
// staff decision. The DB is a scripted fake: each select() pops the next
// queued result; inserts and updates are recorded.

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  staff: true,
  selects: [] as unknown[][],
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  updates: [] as unknown[],
  updateReturns: [{ id: "req-1" }] as unknown[],
  insertError: null as unknown,
  listRestrictions: vi.fn(),
  liftRestriction: vi.fn(),
  rateAllowed: true,
  sendUpheld: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fakeDb = vi.hoisted(() => {
  function chain(result: () => unknown) {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy"]) c[m] = () => c;
    c.limit = () => Promise.resolve(result());
    return c;
  }
  const db = {
    select: () => chain(() => h.selects.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (h.insertError) throw h.insertError;
        h.inserts.push({ table, values });
        const p = Promise.resolve();
        return Object.assign(p, { returning: () => Promise.resolve([{ id: "req-1" }]) });
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            h.updates.push(values);
            return Promise.resolve(h.updateReturns);
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
  };
  return db;
});

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/auth/roles", () => ({ isPlatformStaff: () => Promise.resolve(h.staff) }));
vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/avserv/restrictions", () => ({
  listRestrictions: h.listRestrictions,
  liftRestriction: h.liftRestriction,
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () => Promise.resolve({ allowed: h.rateAllowed }),
}));
vi.mock("@/lib/email/send", () => ({ sendRestrictionReviewUpheldEmail: h.sendUpheld }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { submitReviewRequestAction } from "@/app/(portal)/account/review/actions";
import { decideReviewAction } from "@/app/(portal)/admin/restriction-reviews/actions";

const ACCOUNT = "11111111-1111-5111-8111-111111111111";
const RID = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";
const REQ = "55555555-5555-4555-8555-555555555555";

function restriction(state: Restriction["state"], id = RID): Restriction {
  return {
    id,
    accountId: ACCOUNT,
    scope: "incident_detection",
    state,
    reasonCode: "incident_abuse",
    userReason: "Paused after a review of recent automatic alerts.",
    operatorNote: "internal",
    issuedBy: "operator:a",
    issuedAt: "2026-09-28T16:00:00Z",
    activatedAt: "2026-09-28T18:30:00Z",
    liftedAt: null,
    liftNote: null,
    liftedBy: null,
  };
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.staff = true;
  h.selects = [];
  h.inserts = [];
  h.updates = [];
  h.updateReturns = [{ id: REQ }];
  h.insertError = null;
  h.rateAllowed = true;
  h.listRestrictions.mockResolvedValue([restriction("active")]);
  h.liftRestriction.mockResolvedValue(restriction("lifted"));
  h.sendUpheld.mockResolvedValue(undefined);
});vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));


describe("submitReviewRequestAction", () => {
  const form = () => fd({ restrictionId: RID, submissionKey: KEY, message: "These were false alarms from a rough road." });

  it("records an open request plus its log row for a restriction in force on the user's account", async () => {
    h.selects = [[], [{ avservAccountId: ACCOUNT }]];

    const res = await submitReviewRequestAction(null, form());

    expect(res).toEqual({ ok: true, replayed: false });
    expect(h.listRestrictions).toHaveBeenCalledWith(ACCOUNT);
    expect(h.inserts).toHaveLength(2);
    expect(h.inserts[0]!.values).toMatchObject({ userId: "u1", avservAccountId: ACCOUNT, restrictionId: RID, submissionKey: KEY });
    expect(h.inserts[1]!.values).toMatchObject({ action: "submitted", actorUserId: "u1" });
    // The user's free text is never logged.
    expect(JSON.stringify(h.log.info.mock.calls)).not.toMatch(/rough road/);
  });

  it("replays a double submit as the same request without touching AvServ", async () => {
    h.selects = [[{ id: REQ }]];
    expect(await submitReviewRequestAction(null, form())).toEqual({ ok: true, replayed: true });
    expect(h.listRestrictions).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses an id that isn't in force on the user's OWN account (never looked up)", async () => {
    h.selects = [[], [{ avservAccountId: ACCOUNT }]];
    h.listRestrictions.mockResolvedValue([restriction("active", "66666666-6666-4666-8666-666666666666")]);

    const res = await submitReviewRequestAction(null, form());

    expect(res.ok).toBe(false);
    expect(h.listRestrictions).toHaveBeenCalledWith(ACCOUNT);
    expect(h.inserts).toHaveLength(0);
  });

  it("refuses a pending or lifted restriction", async () => {
    for (const state of ["pending", "lifted"] as const) {
      h.selects = [[], [{ avservAccountId: ACCOUNT }]];
      h.listRestrictions.mockResolvedValue([restriction(state)]);
      expect((await submitReviewRequestAction(null, form())).ok).toBe(false);
    }
    expect(h.inserts).toHaveLength(0);
  });

  it("answers 'already under review' when the one-open rule fires", async () => {
    h.selects = [[], [{ avservAccountId: ACCOUNT }], []];
    h.insertError = Object.assign(new Error("dup"), { code: "23505" });

    const res = await submitReviewRequestAction(null, form());
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/already under review/) });
  });

  it("is rate-limited per account", async () => {
    h.selects = [[], [{ avservAccountId: ACCOUNT }]];
    h.rateAllowed = false;
    expect((await submitReviewRequestAction(null, form())).ok).toBe(false);
    expect(h.listRestrictions).not.toHaveBeenCalled();
  });

  it("fails loud when AvServ can't be read", async () => {
    h.selects = [[], [{ avservAccountId: ACCOUNT }]];
    h.listRestrictions.mockRejectedValue(new AvServContractError("down"));
    const res = await submitReviewRequestAction(null, form());
    expect(res.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });

  it("refuses when signed out, unlinked, or the message is too short", async () => {
    h.sessionUserId = undefined;
    expect((await submitReviewRequestAction(null, form())).ok).toBe(false);
    h.sessionUserId = "u1";
    h.selects = [[], [{ avservAccountId: null }]];
    expect((await submitReviewRequestAction(null, form())).ok).toBe(false);
    const short = await submitReviewRequestAction(null, fd({ restrictionId: RID, submissionKey: KEY, message: "no" }));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.fieldErrors?.message).toBeDefined();
  });
});

describe("decideReviewAction", () => {
  const openRequest = [{ status: "open", accountId: ACCOUNT, restrictionId: RID, userEmail: "jane@example.com" }];
  const decide = (decision: string, note = "Checked the alerts: a rough road, not abuse.") =>
    decideReviewAction(null, fd({ requestId: REQ, decision, note }));

  it("lifts on AvServ FIRST as portal:<staff>, then records the decision and log, and sends no email", async () => {
    h.selects = [openRequest];
    const order: string[] = [];
    h.liftRestriction.mockImplementation(async () => {
      order.push("avserv");
      return restriction("lifted");
    });

    const res = await decide("lift");

    expect(res).toEqual({ ok: true });
    expect(h.liftRestriction).toHaveBeenCalledWith(ACCOUNT, RID, {
      note: "Checked the alerts: a rough road, not abuse.",
      liftedBy: "portal:u1",
    });
    expect(order).toEqual(["avserv"]);
    expect(h.updates[0]).toMatchObject({ status: "lifted", decidedByUserId: "u1" });
    expect(h.inserts[0]!.values).toMatchObject({ action: "lifted", actorUserId: "u1" });
    expect(h.sendUpheld).not.toHaveBeenCalled();
  });

  it("records nothing when the AvServ lift fails, and shows AvServ's words", async () => {
    h.selects = [openRequest];
    h.liftRestriction.mockRejectedValue(
      new AvServContractError("x", { status: 400, code: "invalid_note", detail: "too long" }),
    );
    const res = await decide("lift");
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/invalid_note/) });
    expect(h.updates).toHaveLength(0);
  });

  it("upholds: records it, then emails the user the AvServ userReason (never the staff note)", async () => {
    h.selects = [openRequest];
    const res = await decide("uphold", "internal staff reasoning");

    expect(res).toEqual({ ok: true });
    expect(h.liftRestriction).not.toHaveBeenCalled();
    expect(h.updates[0]).toMatchObject({ status: "upheld" });
    const [to, params] = h.sendUpheld.mock.calls[0]!;
    expect(to).toBe("jane@example.com");
    expect(params.userReason).toBe("Paused after a review of recent automatic alerts.");
    expect(JSON.stringify(params)).not.toMatch(/internal staff reasoning/);
    expect(params.reviewUrl).toMatch(new RegExp(`/account/review\\?restriction=${RID}$`));
  });

  it("keeps an uphold when its email fails, and says so", async () => {
    h.selects = [openRequest];
    h.sendUpheld.mockRejectedValue(new Error("resend down"));
    expect(await decide("uphold")).toEqual({ ok: true, emailFailed: true });
    expect(h.updates[0]).toMatchObject({ status: "upheld" });
    expect(h.log.error).toHaveBeenCalled();
  });

  it("refuses to uphold a lifted restriction, and to close one still in force", async () => {
    h.selects = [openRequest];
    h.listRestrictions.mockResolvedValue([restriction("lifted")]);
    expect((await decide("uphold")).ok).toBe(false);
    h.selects = [openRequest];
    h.listRestrictions.mockResolvedValue([restriction("active")]);
    expect((await decide("close")).ok).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("closes a request whose restriction was already lifted elsewhere", async () => {
    h.selects = [openRequest];
    h.listRestrictions.mockResolvedValue([restriction("lifted")]);
    expect(await decide("close")).toEqual({ ok: true });
    expect(h.updates[0]).toMatchObject({ status: "closed" });
    expect(h.liftRestriction).not.toHaveBeenCalled();
  });

  it("refuses non-staff, a missing note, and an already-decided request", async () => {
    h.staff = false;
    expect((await decide("lift")).ok).toBe(false);
    h.staff = true;
    const noNote = await decide("lift", " ");
    expect(noNote.ok).toBe(false);
    if (!noNote.ok) expect(noNote.fieldErrors?.note).toBeDefined();
    h.selects = [[{ ...openRequest[0], status: "upheld" }]];
    expect((await decide("lift")).ok).toBe(false);
    expect(h.liftRestriction).not.toHaveBeenCalled();
  });

  it("detects a concurrent decision (no open row left to update)", async () => {
    h.selects = [openRequest];
    h.updateReturns = [];
    const res = await decide("uphold");
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Someone else/) });
    expect(h.sendUpheld).not.toHaveBeenCalled();
  });
});
