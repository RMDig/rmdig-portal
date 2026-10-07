import { z } from "zod";

import { avservFetch, failureCode, isMock } from "./request";
import type { AvServNode } from "./sar-teams";

// AvServ's node health (AvServ docs/contracts/node_health.md): disk headroom
// on the Docker VM, the database disk and the backup-ring disk, and the last
// daily Docker cleanup, for one node. Private (route group node_health on
// svc-key-portal-1), never on the public status page. AvServ computes every
// status; the portal only shows it. Read every node.

const Status = z.enum(["ok", "warn", "fail", "unknown"]);

export const NodeHealthCheck = z.object({
  name: z.string(),
  label: z.string(),
  status: Status,
  freeBytes: z.number().nullable().optional(),
  totalBytes: z.number().nullable().optional(),
  freePct: z.number().nullable().optional(),
  reason: z.string().nullable(),
});
export type NodeHealthCheck = z.infer<typeof NodeHealthCheck>;

export const NodeHealth = z.object({
  node: z.string(),
  asOf: z.string(),
  // The worst check; AvServ counts unknown as warn here.
  status: z.enum(["ok", "warn", "fail"]),
  checks: z.array(NodeHealthCheck),
});
export type NodeHealth = z.infer<typeof NodeHealth>;

const ErrorBody = z.object({ code: z.string().optional() });

export type NodeHealthResult = { ok: true; node: string; health: NodeHealth } | { ok: false; node: string; code: string };

export async function readNodeHealth(node: AvServNode): Promise<NodeHealthResult> {
  if (isMock(node.baseUrl)) {
    return { ok: true, node: node.name, health: { node: node.name, asOf: new Date().toISOString(), status: "ok", checks: [] } };
  }
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, "/v1/internal/node-health", { method: "GET" });
  } catch (err) {
    return { ok: false, node: node.name, code: failureCode(err, { call: "node_health", node: node.name }) };
  }
  if (!res.ok) {
    const err = ErrorBody.safeParse(await res.json().catch(() => null));
    return { ok: false, node: node.name, code: (err.success && err.data.code) || `http_${res.status}` };
  }
  const parsed = NodeHealth.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, node: node.name, health: parsed.data } : { ok: false, node: node.name, code: "bad_response" };
}

const GB = 1e9;

/** One check in words: "34.7% free (33.0 of 95.0 GB)", or AvServ's reason. */
export function describeHealthCheck(c: NodeHealthCheck): string {
  const space =
    c.freePct != null && c.freeBytes != null && c.totalBytes != null
      ? `${c.freePct}% free (${(c.freeBytes / GB).toFixed(1)} of ${(c.totalBytes / GB).toFixed(1)} GB)`
      : null;
  return [space, c.reason].filter(Boolean).join(" · ") || c.status;
}
