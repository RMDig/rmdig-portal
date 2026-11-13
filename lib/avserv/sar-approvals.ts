import { z } from "zod";

import { avservFetch, failureCode, isMock } from "./request";
import type { AvServNode } from "./sar-teams";

// A confirm-first team's approvals (AvServ sar_terms.md §6; plan 41 R7; portal
// plan 33 D4, 9.8). The request is a user's acceptance of the team's terms; the
// team approves or declines the acceptance, never a check-out. Read every node
// and merge (lib/sar/approvals-rules.ts); send each decision to every node.
// Route group sar_approve, default-deny: a 403 means our key lacks it there.

const Decision = z.object({ state: z.enum(["approved", "declined"]), at: z.string(), by: z.string() });

const Item = z.object({
  acceptanceId: z.string().min(1).max(100),
  termsVersion: z.number().int(),
  acceptedAt: z.string(),
  userDisplayName: z.string().nullable(),
  standing: z.enum(["pending", "approved", "declined"]),
  decision: Decision.nullable(),
});
export type ApprovalItem = z.infer<typeof Item>;

const Page = z.object({ items: z.array(Item), nextCursor: z.string().nullable() });
const ErrorBody = z.object({ code: z.string().optional() });

// AvServ's page limit, and enough pages for any team's list; a list longer
// than this is reported as cut, never shown as complete.
const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

export type ApprovalListResult = { ok: true; items: ApprovalItem[]; truncated: boolean } | { ok: false; status: number | undefined; code: string };

async function errorCode(res: Response): Promise<string> {
  const body = ErrorBody.safeParse(await res.json().catch(() => null));
  return (body.success && body.data.code) || `http_${res.status}`;
}

/** One node's approval requests for a team, every page. `state: "all"` also
 *  lists decided ones, so a team can reverse a decision. Each read is logged
 *  on the node as a disclosure to `readerUserId` before it answers. */
export async function listApprovalRequests(
  node: AvServNode,
  orgId: string,
  readerUserId: string,
  state: "pending" | "all",
): Promise<ApprovalListResult> {
  if (isMock(node.baseUrl)) return { ok: true, items: [], truncated: false };
  const items: ApprovalItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ state, limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) });
    let res: Response;
    try {
      res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(orgId)}/approval-requests?${q}`, {
        method: "GET",
        headers: { "x-avai-reader": `portal-user:${readerUserId}` },
      });
    } catch (err) {
      return { ok: false, status: undefined, code: failureCode(err, { call: "sar_approval_requests", node: node.name }) };
    }
    if (!res.ok) return { ok: false, status: res.status, code: await errorCode(res) };
    const parsed = Page.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, status: res.status, code: "bad_response" };
    items.push(...parsed.data.items);
    cursor = parsed.data.nextCursor;
    if (!cursor) return { ok: true, items, truncated: false };
  }
  return { ok: true, items, truncated: true };
}

export type DecideResult = { ok: true; decidedAt: string } | { ok: false; status: number | undefined; code: string };

/** Record a decision on one node. The Idempotency-Key is the decision's id,
 *  the same on every node, so a repeat is the same decision. */
export async function decideApproval(
  node: AvServNode,
  orgId: string,
  acceptanceId: string,
  body: { state: "approved" | "declined"; by: string },
  idempotencyKey: string,
): Promise<DecideResult> {
  if (isMock(node.baseUrl)) return { ok: true, decidedAt: new Date().toISOString() };
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(orgId)}/approvals/${encodeURIComponent(acceptanceId)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: undefined, code: failureCode(err, { call: "sar_approval_decide", node: node.name }) };
  }
  if (!res.ok) return { ok: false, status: res.status, code: await errorCode(res) };
  const parsed = z.object({ decidedAt: z.string() }).safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, decidedAt: parsed.data.decidedAt } : { ok: false, status: res.status, code: "bad_response" };
}
