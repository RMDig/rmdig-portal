import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AvServ's test alert call (sar_test_alert.md §2–3): one POST per node, the
// caller's Idempotency-Key, every answer mapped to a result, never a throw.

vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt") }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const NODE = { name: "avserv-2.example", baseUrl: "https://avserv-2.example" };
const BODY: { displayName: string; email: string | null; drill: boolean } = { displayName: "Summit County SAR", email: "oncall@summitsar.org", drill: false };
const KEY = "4f7f1d2e-1c1b-4c5b-9a7e-1f2e3d4c5b6a";
const ANSWER = {
  testId: "abc123",
  node: "avserv-2",
  sentAt: "2026-11-11T16:00:00Z",
  code: "482915",
  channels: [
    { kind: "portal", result: "delivered", detail: null },
    { kind: "email", result: "accepted", detail: null },
  ],
};

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "https://avserv-2.example";
});
afterEach(() => vi.unstubAllGlobals());

async function send(res: Response | Error, node = NODE, body = BODY) {
  const fetchMock = vi.fn(() => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res)));
  vi.stubGlobal("fetch", fetchMock);
  const { sendSarTestAlert } = await import("@/lib/avserv/sar-test-alert");
  return { result: await sendSarTestAlert(node, "org-1", body, KEY), fetchMock };
}

describe("sendSarTestAlert", () => {
  it("POSTs the body to the team's test-alert route with the caller's Idempotency-Key", async () => {
    const { result, fetchMock } = await send(json(200, ANSWER));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://avserv-2.example/v1/internal/sar-teams/org-1/test-alert");
    expect(init.method).toBe("POST");
    expect(init.headers["idempotency-key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual(BODY);
    expect(result).toEqual({
      ok: true,
      sent: {
        testId: "abc123",
        avservNode: "avserv-2",
        sentAt: "2026-11-11T16:00:00Z",
        code: "482915",
        portal: { result: "delivered", detail: null },
        email: { result: "accepted", detail: null },
      },
    });
  });

  it("reports a channel the answer leaves out as missing, never as sent", async () => {
    const { result } = await send(json(200, { ...ANSWER, channels: [ANSWER.channels[0]] }));
    expect(result.ok && result.sent.email).toEqual({ result: "missing", detail: "AvServ's answer didn't report this channel" });
  });

  it("refuses an answer off the contract (a code that isn't six digits)", async () => {
    const { result } = await send(json(200, { ...ANSWER, code: "12" }));
    expect(result).toEqual({ ok: false, status: 200, code: "bad_response" });
  });

  it("names AvServ's error code and field", async () => {
    const { result } = await send(json(400, { code: "invalid_request", field: "displayName" }));
    expect(result).toEqual({ ok: false, status: 400, code: "invalid_request: displayName", retryAfterSec: undefined });
  });

  it("carries Retry-After on a 429, and a bare status when there's no body", async () => {
    expect((await send(json(429, { code: "rate_limited" }, { "retry-after": "1200" }))).result).toEqual({ ok: false, status: 429, code: "rate_limited", retryAfterSec: 1200 });
    expect((await send(new Response("", { status: 404 }))).result).toMatchObject({ ok: false, status: 404, code: "http_404" });
  });

  it("is unreachable, not a throw, when the node doesn't answer", async () => {
    const { result } = await send(new TypeError("fetch failed"));
    expect(result).toEqual({ ok: false, status: undefined, code: "unreachable" });
  });

  it("answers from a mock node with the mock code and no email when there's no address", async () => {
    const { result, fetchMock } = await send(json(500, {}), { name: "mock", baseUrl: "mock://localhost" }, { ...BODY, email: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, sent: { code: "123456", portal: { result: "delivered" }, email: { result: "not_configured" } } });
  });
});
