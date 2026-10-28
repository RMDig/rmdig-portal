import { describe, expect, it } from "vitest";

import type { ErasurePreview, ErasureRecord, NodeResult } from "@/lib/avserv/erasure-types";
import { completionNoteText, eraseOutcome, previewVerdict, statusSummary } from "@/lib/deletion/erasure";

// The operator erasure's rules (account_erasure.md rev 1): when Erase is
// allowed, what each AvServ answer means, and what every node holds after.

const ACCT = "11111111-1111-4111-8111-111111111111";
const preview = (node: string, p: Partial<ErasurePreview> = {}): NodeResult<ErasurePreview> => ({
  node,
  ok: true,
  value: { accountId: ACCT, node, alreadyErased: false, erasable: true, live: [], ...p },
});
const record = (node: string, p: Partial<ErasureRecord> = {}): ErasureRecord => ({
  accountId: ACCT,
  alreadyErased: false,
  requestRef: "22222222-2222-4222-8222-222222222222",
  evidence: "tombstone",
  originNode: "avserv-2",
  requestedAt: "2026-10-28T17:00:00Z",
  appliedAt: "2026-10-28T17:00:01Z",
  rows: { accounts: 1, checkouts: 3, contacts: 0 },
  requestedByKid: "svc-key-portal-erasure",
  reader: "portal-user:u1",
  ...p,
});
const fail = <T>(node: string, code: string, extra: Record<string, unknown> = {}): NodeResult<T> => ({ node, ok: false, code, ...extra });

describe("previewVerdict", () => {
  it("allows the erase only when every node is erasable or already erased", () => {
    expect(previewVerdict([preview("a"), preview("b")]).canErase).toBe(true);
    expect(previewVerdict([preview("a"), preview("b", { alreadyErased: true, erasable: false })]).canErase).toBe(true);
  });

  it("blocks on live safety state on any node, and names it", () => {
    const v = previewVerdict([preview("a"), preview("b", { erasable: false, live: [{ kind: "checkout", id: "c1" }] })]);
    expect(v.canErase).toBe(false);
    expect(v.nodes[1]).toEqual({ node: "b", state: "live", live: [{ kind: "checkout", id: "c1" }] });
  });

  it("blocks when a node is unreachable, lacks the account, or can't erase", () => {
    expect(previewVerdict([preview("a"), fail("b", "unreachable")]).canErase).toBe(false);
    expect(previewVerdict([preview("a"), fail("b", "account_not_found")]).nodes[1]).toMatchObject({ state: "not_found" });
    expect(previewVerdict([preview("a", { erasable: false })]).nodes[0]).toMatchObject({ state: "unavailable", code: "not_erasable" });
  });

  it("never allows an erase with no nodes", () => {
    expect(previewVerdict([]).canErase).toBe(false);
  });
});

describe("eraseOutcome", () => {
  it("records a 200, including a repeat", () => {
    expect(eraseOutcome({ node: "a", ok: true, value: record("a") })).toMatchObject({ kind: "erased" });
    expect(eraseOutcome({ node: "a", ok: true, value: record("a", { alreadyErased: true }) })).toMatchObject({ kind: "erased" });
  });

  it.each(["email_mismatch", "account_newer_than_request"])("stops on %s (never retried)", (code) => {
    expect(eraseOutcome(fail("a", code, { status: 409 }))).toEqual({ kind: "stop", code });
  });

  it("passes the live items of a blocked erase through", () => {
    const live = [{ kind: "help_request", id: "h1" }];
    expect(eraseOutcome(fail("a", "erasure_blocked_active", { status: 409, live }))).toEqual({ kind: "blocked", live });
  });

  it("says try later for the cap, unavailable, and not replicated yet", () => {
    expect(eraseOutcome(fail("a", "erasure_rate_limited", { status: 429, retryAfterSec: 3600 }))).toEqual({
      kind: "later",
      code: "erasure_rate_limited",
      retryAfterSec: 3600,
    });
    expect(eraseOutcome(fail("a", "erasure_unavailable", { status: 503 }))).toMatchObject({ kind: "later" });
    expect(eraseOutcome(fail("a", "account_not_found", { status: 404 }))).toMatchObject({ kind: "later", code: "account_not_found" });
  });

  it("treats no answer, or a 5xx without a contract code, as unknown: it may have run", () => {
    expect(eraseOutcome(fail("a", "unreachable"))).toEqual({ kind: "unknown" });
    expect(eraseOutcome(fail("a", "http_502", { status: 502 }))).toEqual({ kind: "unknown" });
  });

  it("reports our own failures as faults", () => {
    expect(eraseOutcome(fail("a", "invalid_request", { status: 400 }))).toMatchObject({ kind: "fault", code: "invalid_request" });
    expect(eraseOutcome(fail("a", "path_not_allowed", { status: 403 }))).toMatchObject({ kind: "fault" });
    expect(eraseOutcome(fail("a", "http_401", { status: 401 }))).toMatchObject({ kind: "fault" });
    expect(eraseOutcome(fail("a", "bad_response", { status: 200 }))).toMatchObject({ kind: "fault" });
  });
});

describe("statusSummary", () => {
  it("is erased only when every node has the record", () => {
    expect(statusSummary([{ node: "a", ok: true, value: record("a") }, { node: "b", ok: true, value: record("b") }]).overall).toBe("erased");
  });

  it("is held when one node has it and another doesn't yet", () => {
    expect(statusSummary([{ node: "a", ok: true, value: record("a") }, fail("b", "not_erased", { status: 404 })]).overall).toBe("held");
  });

  it("is not_erased when no node has it, and incomplete when a node didn't answer", () => {
    expect(statusSummary([fail("a", "not_erased"), fail("b", "not_erased")]).overall).toBe("not_erased");
    expect(statusSummary([{ node: "a", ok: true, value: record("a") }, fail("b", "unreachable")]).overall).toBe("incomplete");
    expect(statusSummary([]).overall).toBe("incomplete");
  });
});

describe("completionNoteText", () => {
  it("names the account, origin, non-zero row counts and every node", () => {
    const s = statusSummary([{ node: "avserv-2", ok: true, value: record("avserv-2") }, fail("avserv-3", "not_erased")]);
    expect(completionNoteText(ACCT, s)).toBe(
      `AvServ: erased AvAI account ${ACCT} (origin avserv-2, applied 2026-10-28T17:00:01Z; rows accounts 1, checkouts 3). Status per node: avserv-2: erased; avserv-3: not erased.`,
    );
  });

  it("is empty when nothing was erased", () => {
    expect(completionNoteText(ACCT, statusSummary([fail("a", "not_erased")]))).toBe("");
  });
});
