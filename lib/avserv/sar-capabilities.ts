import { z } from "zod";

import { avservFetch, failureCode, isMock } from "./request";
import type { AvServNode } from "./sar-teams";

// Which team-sync protocol revision each AvServ node understands
// (sar_team_sync.md, "The version gate"): GET /v1/internal/sar-teams/capabilities,
// service JWT, group sar_sync. A node below a revision ignores that revision's
// fields, so the portal sends them only once EVERY node reports it: revision 4
// for `deviceServiceArea` and `nearbyListing` (AvApp plan 68), revision 3 for
// a drill team's `drill: true` (plan 37 §4.5), revision 2 for plan 33 §6.2.
//
// Not to be confused with sar_orgs.sync_revision, the portal's own per-team
// send counter.

const Capabilities = z.object({ syncRevision: z.number().int() });
const ErrorBody = z.object({ code: z.string().optional() });

/** One node's answer. `syncRevision` is null when the node answered but gave
 *  no usable revision; `code` says why a node couldn't be read. */
export type NodeCapability =
  | { node: string; ok: true; syncRevision: number | null }
  | { node: string; ok: false; code: string };

export async function readNodeCapability(node: AvServNode): Promise<NodeCapability> {
  // The mock stands in for a fully upgraded fleet.
  if (isMock(node.baseUrl)) return { node: node.name, ok: true, syncRevision: 4 };
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, "/v1/internal/sar-teams/capabilities", { method: "GET" });
  } catch (err) {
    return { node: node.name, ok: false, code: failureCode(err, { call: "sar_capabilities", node: node.name }) };
  }
  // A node older than the route answers it as GET §2 with an orgId that isn't a
  // UUID (400 invalid_request). That, and any other non-200, means "hold".
  if (!res.ok) {
    const err = ErrorBody.safeParse(await res.json().catch(() => null));
    return { node: node.name, ok: false, code: (err.success && err.data.code) || `http_${res.status}` };
  }
  const parsed = Capabilities.safeParse(await res.json().catch(() => null));
  return { node: node.name, ok: true, syncRevision: parsed.success ? parsed.data.syncRevision : null };
}

export interface FleetRevision {
  /** The lowest syncRevision every node reported: 0 when there are no nodes,
   *  or any node couldn't be read or gave no revision ("hold" for every
   *  gated field). A field of revision r may be sent when this is ≥ r. */
  revision: number;
  nodes: NodeCapability[];
}

/** Read every node; the fleet understands the lowest revision any reports. */
export async function readFleetRevision(nodes: AvServNode[]): Promise<FleetRevision> {
  const read = await Promise.all(nodes.map(readNodeCapability));
  const known = read.map((n) => (n.ok && n.syncRevision !== null ? n.syncRevision : 0));
  return { revision: known.length > 0 ? Math.min(...known) : 0, nodes: read };
}
