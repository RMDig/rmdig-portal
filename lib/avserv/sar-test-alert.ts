import { z } from "zod";

import type { AvServNode } from "./node-list";
import { avservFetch, failureCode, isMock, retryAfterSec } from "./request";

// AvServ's test alert for a team (AvServ sar_test_alert.md; plan 33 §6.9 G2
// item 3). One call per node: each node's answer proves that node's two paths,
// the signed message to the portal's intake and the email to the team's
// on-call address. AvServ sends both whatever each channel does and reports
// them in a 200; it never retries, so the portal shows the result and staff
// send again.

export const MOCK_TEST_CODE = "123456";

const Channel = z.object({
  kind: z.string(),
  result: z.string(),
  detail: z.string().nullable().optional(),
});

const TestAlertOk = z.object({
  testId: z.string().min(1).max(200),
  node: z.string().min(1).max(100),
  sentAt: z.string(),
  code: z.string().regex(/^\d{6}$/),
  channels: z.array(Channel),
});

export interface TestAlertSent {
  testId: string;
  /** AvServ's own name for the node (e.g. "avserv-2"), as its intake messages carry it. */
  avservNode: string;
  sentAt: string;
  code: string;
  portal: { result: string; detail: string | null };
  email: { result: string; detail: string | null };
}

export type TestAlertResult =
  | { ok: true; sent: TestAlertSent }
  | { ok: false; status: number | undefined; code: string; retryAfterSec?: number };

export interface TestAlertBody {
  displayName: string;
  email: string | null;
  drill: boolean;
}

const ErrorBody = z.object({ code: z.string().optional(), field: z.string().optional() });

// A channel the answer leaves out is reported, not assumed: the portal never
// shows a path as tested when AvServ didn't say.
function channel(channels: z.infer<typeof Channel>[], kind: string) {
  const c = channels.find((x) => x.kind === kind);
  return c ? { result: c.result, detail: c.detail ?? null } : { result: "missing", detail: "AvServ's answer didn't report this channel" };
}

/** Ask one node to send the test. Never throws: every failure comes back as a
 *  code for the staff page. The Idempotency-Key is the caller's, new per node
 *  and per test, so a repeat returns the first answer and sends nothing. */
export async function sendSarTestAlert(node: AvServNode, orgId: string, body: TestAlertBody, idempotencyKey: string): Promise<TestAlertResult> {
  if (isMock(node.baseUrl)) {
    // The mock "sends" nothing: no message reaches the intake, so a mock test
    // can be confirmed by its code but never marked received.
    return {
      ok: true,
      sent: {
        testId: idempotencyKey.replace(/-/g, ""),
        avservNode: "mock",
        sentAt: new Date().toISOString(),
        code: MOCK_TEST_CODE,
        portal: { result: "delivered", detail: null },
        email: body.email ? { result: "accepted", detail: null } : { result: "not_configured", detail: "no on-call email" },
      },
    };
  }
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(orgId)}/test-alert`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
      // AvServ answers after both channels have been tried.
      timeoutMs: 15_000,
    });
  } catch (err) {
    return { ok: false, status: undefined, code: failureCode(err, { call: "sar_test_alert", node: node.name }) };
  }
  if (res.ok) {
    const parsed = TestAlertOk.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, status: res.status, code: "bad_response" };
    const a = parsed.data;
    return {
      ok: true,
      sent: { testId: a.testId, avservNode: a.node, sentAt: a.sentAt, code: a.code, portal: channel(a.channels, "portal"), email: channel(a.channels, "email") },
    };
  }
  const err = ErrorBody.safeParse(await res.json().catch(() => null));
  const code = (err.success && err.data.code) || `http_${res.status}`;
  const field = err.success && err.data.field ? `: ${err.data.field}` : "";
  return { ok: false, status: res.status, code: `${code}${field}`, retryAfterSec: retryAfterSec(res) };
}
