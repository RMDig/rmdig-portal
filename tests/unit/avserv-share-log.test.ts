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

import { readShareLog } from "@/lib/avserv/share-log";
import { AvServError } from "@/lib/avserv/request";

const NODE = { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" };
const ACCT = "22222222-2222-4222-8222-222222222222";
const row = (o = {}) => ({ at: "2026-10-04T10:00:00Z", node: "avserv-2", teamId: "t1", kind: "dispatch", subject: "s", messageKind: "overdue", channel: "portal", fields: ["lastFix"], reader: null, drill: false, ...o });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => h.fetch.mockReset());

describe("readShareLog", () => {
  it("reads every page for the account", async () => {
    h.fetch
      .mockResolvedValueOnce(json(200, { items: [row()], nextCursor: "c2" }))
      .mockResolvedValueOnce(json(200, { items: [row({ teamId: "t2" })], nextCursor: null }));
    const r = await readShareLog(NODE, ACCT);
    expect(r.ok && r.items.map((i) => i.teamId)).toEqual(["t1", "t2"]);
    expect(h.fetch.mock.calls[0]![1]).toBe(`/v1/internal/data-share-log?accountId=${ACCT}&limit=500`);
    expect(h.fetch.mock.calls[1]![1]).toBe(`/v1/internal/data-share-log?accountId=${ACCT}&limit=500&cursor=c2`);
  });

  it("reports log_unavailable, an unreachable node, a malformed answer and a missing drill flag as failures", async () => {
    h.fetch.mockResolvedValueOnce(json(503, { code: "log_unavailable" }));
    expect(await readShareLog(NODE, ACCT)).toEqual({ ok: false, node: NODE.name, code: "log_unavailable" });
    h.fetch.mockRejectedValueOnce(new AvServError("AvServ request failed: timeout", undefined, "unreachable"));
    expect(await readShareLog(NODE, ACCT)).toEqual({ ok: false, node: NODE.name, code: "unreachable" });
    const { drill: _drill, ...noDrill } = row();
    h.fetch.mockResolvedValueOnce(json(200, { items: [noDrill], nextCursor: null }));
    expect(await readShareLog(NODE, ACCT)).toEqual({ ok: false, node: NODE.name, code: "bad_response" });
  });
  it("reports a fault of ours (e.g. the signing key) as itself, not as an unreachable node", async () => {
    h.fetch.mockRejectedValueOnce(new TypeError('"pkcs8" must be PKCS#8 formatted string'));
    const r = await readShareLog(NODE, ACCT);
    expect(r).toMatchObject({ ok: false, code: expect.stringMatching(/^portal_fault: "pkcs8"/) });
  });
});
