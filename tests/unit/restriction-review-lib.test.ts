import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Restriction } from "@/lib/avserv/restrictions-types";
import {
  reviewableRestrictions,
  reviewDecisionSchema,
  reviewRequestSchema,
  scopeLabel,
  staffActor,
} from "@/lib/restrictions/review";

const base: Restriction = {
  id: "33333333-3333-4333-8333-333333333333",
  accountId: "11111111-1111-5111-8111-111111111111",
  scope: "incident_detection",
  state: "active",
  reasonCode: "other",
  userReason: "x",
  operatorNote: null,
  issuedBy: "operator:a",
  issuedAt: "2026-09-28T16:00:00Z",
  activatedAt: null,
  liftedAt: null,
  liftNote: null,
  liftedBy: null,
};

describe("review rules", () => {
  it("offers review only for restrictions in force (not pending, not lifted)", () => {
    const list = (["pending", "active", "lifted"] as const).map((state) => ({ ...base, state }));
    expect(reviewableRestrictions(list).map((r) => r.state)).toEqual(["active"]);
  });

  it("labels known scopes and passes unknown ones through", () => {
    expect(scopeLabel("incident_detection")).toBe("Automatic Incident Detection");
    expect(scopeLabel("future_scope")).toBe("future_scope");
  });

  it("builds the AvServ actor for a staff user id", () => {
    expect(staffActor("2b1f3c1e-1111-4111-8111-111111111111")).toBe(
      "portal:2b1f3c1e-1111-4111-8111-111111111111",
    );
    expect(() => staffActor("no spaces allowed")).toThrow();
  });

  it("bounds the review message and requires uuids", () => {
    const ok = { restrictionId: base.id, submissionKey: base.id, message: "a".repeat(20) };
    expect(reviewRequestSchema.safeParse(ok).success).toBe(true);
    expect(reviewRequestSchema.safeParse({ ...ok, message: "too short" }).success).toBe(false);
    expect(reviewRequestSchema.safeParse({ ...ok, message: "a".repeat(2001) }).success).toBe(false);
    expect(reviewRequestSchema.safeParse({ ...ok, restrictionId: "x" }).success).toBe(false);
  });

  it("requires a decision note of at most 1000 code points", () => {
    const ok = { requestId: base.id, decision: "lift", note: "Reviewed: false alarms from a rough road." };
    expect(reviewDecisionSchema.safeParse(ok).success).toBe(true);
    expect(reviewDecisionSchema.safeParse({ ...ok, note: "  " }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ ...ok, note: "a".repeat(1001) }).success).toBe(false);
    expect(reviewDecisionSchema.safeParse({ ...ok, decision: "issue" }).success).toBe(false);
  });
});

describe("restrictions mock", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AVSERV_BASE_URL = "mock://localhost";
  });

  it("seeds one active restriction only for a +restricted login, and lifts idempotently", async () => {
    const { findOrCreateAccount } = await import("@/lib/avserv/client");
    const { listRestrictions, liftRestriction } = await import("@/lib/avserv/restrictions");

    const plain = await findOrCreateAccount("plain@rmdig.test");
    expect(await listRestrictions(plain.accountId)).toEqual([]);

    const tagged = await findOrCreateAccount("someone+restricted@rmdig.test");
    const [r] = await listRestrictions(tagged.accountId);
    expect(r).toMatchObject({ state: "active", scope: "incident_detection" });

    const first = await liftRestriction(tagged.accountId, r!.id, { note: "first", liftedBy: "portal:a" });
    const again = await liftRestriction(tagged.accountId, r!.id, { note: "second", liftedBy: "portal:b" });
    expect(first.state).toBe("lifted");
    expect(again).toMatchObject({ liftNote: "first", liftedBy: "portal:a" });
  });

  it("refuses another account's restriction id as not found", async () => {
    const { findOrCreateAccount } = await import("@/lib/avserv/client");
    const { listRestrictions, liftRestriction } = await import("@/lib/avserv/restrictions");
    const tagged = await findOrCreateAccount("owner+restricted@rmdig.test");
    const other = await findOrCreateAccount("other@rmdig.test");
    const [r] = await listRestrictions(tagged.accountId);

    await expect(
      liftRestriction(other.accountId, r!.id, { note: "x", liftedBy: "portal:a" }),
    ).rejects.toMatchObject({ status: 404, code: "restriction_not_found" });
  });
});
