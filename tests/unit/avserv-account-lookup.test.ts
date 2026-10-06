import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/avserv/request", async (orig) => ({
  ...(await orig<object>()),
  avservFetch: h.fetch,
  isMock: (u: string) => u.startsWith("mock://"),
}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { lookupAccountsByEmail, mergeAccountMatches, type AccountMatch } from "@/lib/avserv/account-lookup";
import { AvServError } from "@/lib/avserv/request";

const NODE = { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" };
const m = (o: Partial<AccountMatch> = {}): AccountMatch => ({ accountId: "a1", verified: false, source: "app", status: "active", createdAt: "2026-09-01T00:00:00Z", ...o });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => h.fetch.mockReset());

describe("lookupAccountsByEmail", () => {
  it("POSTs the email in the body (never the URL) and names the operator as reader", async () => {
    h.fetch.mockResolvedValueOnce(json(200, { matches: [m()] }));
    expect(await lookupAccountsByEmail(NODE, "pat@example.org", "staff-1")).toEqual({ ok: true, node: NODE.name, matches: [m()] });
    expect(h.fetch).toHaveBeenCalledWith(NODE.baseUrl, "/v1/internal/accounts/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-avai-reader": "portal-user:staff-1" },
      body: JSON.stringify({ email: "pat@example.org" }),
    });
  });

  it("reports lookup_unavailable, a missing route group and an unreachable node as failures", async () => {
    h.fetch.mockResolvedValueOnce(json(503, { code: "lookup_unavailable" }));
    expect(await lookupAccountsByEmail(NODE, "p@e.org", "s")).toEqual({ ok: false, node: NODE.name, code: "lookup_unavailable" });
    h.fetch.mockResolvedValueOnce(json(403, { code: "path_not_allowed" }));
    expect(await lookupAccountsByEmail(NODE, "p@e.org", "s")).toEqual({ ok: false, node: NODE.name, code: "path_not_allowed" });
    h.fetch.mockRejectedValueOnce(new AvServError("AvServ request failed: timeout", undefined, "unreachable"));
    expect(await lookupAccountsByEmail(NODE, "p@e.org", "s")).toEqual({ ok: false, node: NODE.name, code: "unreachable" });
  });
  it("reports a fault of ours (e.g. the signing key) as itself, not as an unreachable node", async () => {
    h.fetch.mockRejectedValueOnce(new TypeError('"pkcs8" must be PKCS#8 formatted string'));
    const r = await lookupAccountsByEmail(NODE, "p@e.org", "s");
    expect(r).toMatchObject({ ok: false, code: expect.stringMatching(/^portal_fault: "pkcs8"/) });
  });
});

describe("mergeAccountMatches", () => {
  it("merges by account (verified/login if any node says so), login first then oldest", () => {
    const r = mergeAccountMatches([
      { ok: true, node: "a2", matches: [m({ accountId: "app-new", createdAt: "2026-09-10T00:00:00Z" }), m({ accountId: "x" })] },
      { ok: true, node: "a3", matches: [m({ accountId: "x", verified: true, source: "login" }), m({ accountId: "app-old", createdAt: "2026-08-01T00:00:00Z" })] },
    ]);
    expect(r.status).toBe("complete");
    expect(r.matches.map((x) => [x.accountId, x.verified, x.source])).toEqual([
      ["x", true, "login"],
      ["app-old", false, "app"],
      ["app-new", false, "app"],
    ]);
  });

  it("is incomplete with one node down, an error with none", () => {
    expect(mergeAccountMatches([{ ok: true, node: "a2", matches: [] }, { ok: false, node: "a3", code: "lookup_unavailable" }]).status).toBe("incomplete");
    expect(mergeAccountMatches([{ ok: false, node: "a2", code: "unreachable" }]).status).toBe("error");
  });
});
