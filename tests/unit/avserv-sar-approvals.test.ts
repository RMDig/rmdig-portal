import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AvServ's approval routes (sar_terms.md §6; route group sar_approve): the
// list, every page, with the reader named; and a decision with its
// Idempotency-Key. Every answer maps to a result, never a throw.

vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt") }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NODE = { name: "avserv-2", baseUrl: "https://avserv-2.example" };
const ITEM = { acceptanceId: "acc-1", termsVersion: 3, acceptedAt: "2026-11-10T10:00:00Z", userDisplayName: "John Doe", standing: "pending", decision: null };
const KEY = "4f7f1d2e-1c1b-4c5b-9a7e-1f2e3d4c5b6a";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function stub(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn(() => {
    const r = responses.shift()!;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const call = (fetchMock: ReturnType<typeof stub>, i = 0) => fetchMock.mock.calls[i] as unknown as [string, RequestInit & { headers: Record<string, string> }];

describe("listApprovalRequests", () => {
  it("reads every page with the reader named, and returns the items", async () => {
    const fetchMock = stub(json(200, { items: [ITEM], nextCursor: "c2" }), json(200, { items: [{ ...ITEM, acceptanceId: "acc-2" }], nextCursor: null }));
    const { listApprovalRequests } = await import("@/lib/avserv/sar-approvals");
    const r = await listApprovalRequests(NODE, "org-1", "admin-1", "all");
    expect(r).toEqual({ ok: true, items: [ITEM, { ...ITEM, acceptanceId: "acc-2" }], truncated: false });
    const [url, init] = call(fetchMock);
    expect(url).toBe("https://avserv-2.example/v1/internal/sar-teams/org-1/approval-requests?state=all&limit=200");
    expect(init.headers["x-avai-reader"]).toBe("portal-user:admin-1");
    expect(call(fetchMock, 1)[0]).toContain("cursor=c2");
  });

  it("maps a refusal, a bad body and no answer to a code", async () => {
    const { listApprovalRequests } = await import("@/lib/avserv/sar-approvals");
    stub(json(403, { code: "path_not_allowed" }));
    expect(await listApprovalRequests(NODE, "org-1", "a", "pending")).toEqual({ ok: false, status: 403, code: "path_not_allowed" });
    stub(json(422, {}));
    expect(await listApprovalRequests(NODE, "org-1", "a", "pending")).toEqual({ ok: false, status: 422, code: "http_422" });
    stub(json(200, { items: [{ acceptanceId: "x" }], nextCursor: null }));
    expect(await listApprovalRequests(NODE, "org-1", "a", "pending")).toEqual({ ok: false, status: 200, code: "bad_response" });
    stub(new TypeError("fetch failed"));
    expect(await listApprovalRequests(NODE, "org-1", "a", "pending")).toMatchObject({ ok: false, status: undefined, code: "unreachable" });
  });

  it("reports a list longer than it reads as cut, never as complete", async () => {
    const pages = Array.from({ length: 10 }, (_, i) => json(200, { items: [{ ...ITEM, acceptanceId: `acc-${i}` }], nextCursor: `c${i + 1}` }));
    stub(...pages);
    const { listApprovalRequests } = await import("@/lib/avserv/sar-approvals");
    const r = await listApprovalRequests(NODE, "org-1", "a", "all");
    expect(r).toMatchObject({ ok: true, truncated: true });
  });

  it("answers an empty list on the mock node, calling nothing", async () => {
    const fetchMock = stub();
    const { listApprovalRequests } = await import("@/lib/avserv/sar-approvals");
    expect(await listApprovalRequests({ name: "mock", baseUrl: "mock://localhost" }, "org-1", "a", "all")).toEqual({ ok: true, items: [], truncated: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("decideApproval", () => {
  it("POSTs the decision with the caller's Idempotency-Key and returns when it was decided", async () => {
    const fetchMock = stub(json(200, { acceptanceId: "acc-1", state: "approved", decidedAt: "2026-11-11T09:00:00.123Z" }));
    const { decideApproval } = await import("@/lib/avserv/sar-approvals");
    const r = await decideApproval(NODE, "org-1", "acc-1", { state: "approved", by: "portal-user:a" }, KEY);
    expect(r).toEqual({ ok: true, decidedAt: "2026-11-11T09:00:00.123Z" });
    const [url, init] = call(fetchMock);
    expect(url).toBe("https://avserv-2.example/v1/internal/sar-teams/org-1/approvals/acc-1");
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({ state: "approved", by: "portal-user:a" });
  });

  it("maps AvServ's refusals to their codes", async () => {
    const { decideApproval } = await import("@/lib/avserv/sar-approvals");
    for (const [status, code] of [[404, "acceptance_unknown"], [409, "acceptance_revoked"], [422, "team_not_confirm_first"], [503, "sar_capture_unavailable"]] as const) {
      stub(json(status, { code }));
      expect(await decideApproval(NODE, "org-1", "acc-1", { state: "declined", by: "portal-user:a" }, KEY)).toEqual({ ok: false, status, code });
    }
  });
});
