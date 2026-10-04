import { z } from "zod";

import { env } from "../env";
import type { SyncBody } from "../sar/sync-body";
import { AvServError, avservFetch, isMock } from "./request";

// AvServ's SAR team endpoints (sar_team_sync.md §1–2). The portal sends every
// change to EVERY node, never just one: each node keeps the highest revision,
// and a node that missed a PUT also converges from its peer, but the portal
// records each node's answer so staff can see a node that's behind.

export interface AvServNode {
  name: string;
  baseUrl: string;
}

/** Both configured nodes (primary and failover), deduplicated. */
export function avservNodes(): AvServNode[] {
  const urls = [env.AVSERV_BASE_URL, env.AVSERV_FAILOVER_BASE_URL].filter((u): u is string => !!u);
  const unique = [...new Set(urls)];
  return unique.map((baseUrl) => ({ name: isMock(baseUrl) ? "mock" : new URL(baseUrl).host, baseUrl }));
}

const PutOk = z.object({
  orgId: z.string(),
  revision: z.number(),
  applied: z.boolean(),
  usable: z.boolean(),
  unusableReason: z.string().nullable(),
});
export type PutOk = z.infer<typeof PutOk>;

const ErrorBody = z.object({ code: z.string().optional(), error: z.string().optional() });

export type PutResult =
  | { ok: true; result: PutOk }
  | { ok: false; status: number | undefined; code: string; retryable: boolean; detail?: string };

/** PUT the team to one node. Never throws for an AvServ answer; network
 *  failures come back as retryable, so one node's outage can't hide the
 *  other's result. */
export async function putSarTeam(node: AvServNode, body: SyncBody): Promise<PutResult> {
  if (isMock(node.baseUrl)) {
    return { ok: true, result: { orgId: body.orgId, revision: body.revision, applied: true, usable: body.status === "approved", unusableReason: body.status === "approved" ? null : body.status } };
  }
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(body.orgId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // No answer at all (timeout, DNS, refused): the caller logs it loudly.
    return { ok: false, status: undefined, code: "unreachable", retryable: true, detail: (err as Error).message };
  }
  if (res.ok) {
    const parsed = PutOk.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, status: res.status, code: "bad_response", retryable: false };
    return { ok: true, result: parsed.data };
  }
  const err = ErrorBody.safeParse(await res.json().catch(() => null));
  const code = (err.success && err.data.code) || (res.status === 401 ? "unauthorized" : `http_${res.status}`);
  // 409 revision/terms conflicts are portal bugs (AvServ pages): don't retry.
  return { ok: false, status: res.status, code, retryable: res.status === 503 || res.status >= 500 };
}

const NodeView = z.object({
  orgId: z.string(),
  revision: z.number(),
  status: z.string(),
  usable: z.boolean(),
  unusableReason: z.string().nullable().optional(),
  termsVersion: z.number().nullable().optional(),
  openBindings: z.number(),
  channelStatus: z
    .array(z.object({ kind: z.string(), phone: z.string().nullable().optional(), optedOutAt: z.string().nullable(), source: z.string().nullable() }))
    .optional()
    .default([]),
});
export type NodeView = z.infer<typeof NodeView>;

/** One node's view of the team, or null if it has never received it (404). */
export async function getSarTeam(node: AvServNode, orgId: string): Promise<NodeView | null> {
  if (isMock(node.baseUrl)) {
    return { orgId, revision: 0, status: "unknown", usable: false, openBindings: 0, channelStatus: [] };
  }
  const res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(orgId)}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new AvServError(`AvServ ${node.name} answered ${res.status} for the team`, res.status);
  const parsed = NodeView.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AvServError(`AvServ ${node.name} team response failed schema validation`);
  return parsed.data;
}
