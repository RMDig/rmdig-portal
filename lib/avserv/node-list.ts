// Every AvServ node the portal sends a SAR team to and reads it from: the sync
// PUTs, the withdraw check, the capabilities gate, acks and RED reads
// (lib/avserv/sar-teams.ts avservNodes). One list, AVSERV_NODE_URLS, so a new
// node (avserv-1, AvServ plan 36 R6) joins by a config change on the day
// (AvServ, 2026-11-11). Pure and env-free: the build check
// (scripts/check-service-key.ts) uses it too.

export interface AvServNode {
  /** The URL's host (e.g. "avserv-2.rmdig.ai"), or "mock"; stored per node in sar_org_sync. */
  name: string;
  baseUrl: string;
}

const isMock = (u: string) => u.startsWith("mock://");

/** "url,url" → nodes, in order. A malformed list is a config error and
 *  throws, so a typo can't silently leave a node out. Unset is no nodes. */
export function parseNodeUrls(packed: string | undefined): AvServNode[] {
  if (!packed?.trim()) return [];
  const nodes: AvServNode[] = [];
  for (const raw of packed.split(",").map((u) => u.trim()).filter(Boolean)) {
    if (isMock(raw)) {
      nodes.push({ name: "mock", baseUrl: raw });
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`AVSERV_NODE_URLS: "${raw}" is not a URL`);
    }
    if (url.protocol !== "https:") throw new Error(`AVSERV_NODE_URLS: "${raw}" must be https`);
    nodes.push({ name: url.host, baseUrl: raw.replace(/\/+$/, "") });
  }
  const names = nodes.map((n) => n.name);
  if (new Set(names).size !== names.length) throw new Error("AVSERV_NODE_URLS lists a node twice");
  return nodes;
}

export type NodeListCheck = { status: "ok"; nodes: string[] } | { status: "skipped" } | { status: "error"; error: string };

/** For the production build: with a real AvServ, the node list must be set,
 *  parse, and include the primary and failover nodes, so the SAR sync can't
 *  go live reaching fewer nodes than the account calls do. */
export function checkNodeListConfig(e: { AVSERV_BASE_URL?: string; AVSERV_FAILOVER_BASE_URL?: string; AVSERV_NODE_URLS?: string }): NodeListCheck {
  if (!e.AVSERV_BASE_URL || isMock(e.AVSERV_BASE_URL)) return { status: "skipped" };
  let nodes: AvServNode[];
  try {
    nodes = parseNodeUrls(e.AVSERV_NODE_URLS);
  } catch (err) {
    return { status: "error", error: (err as Error).message };
  }
  if (nodes.length === 0) return { status: "error", error: "AVSERV_NODE_URLS is not set: no call would reach any AvServ node" };
  // The first node is the primary: erasure and the one-node device reads go
  // there first (lib/avserv/erasure.ts, device-revoke.ts).
  if (nodes[0]!.name !== new URL(e.AVSERV_BASE_URL).host) {
    return { status: "error", error: `AVSERV_NODE_URLS must start with AVSERV_BASE_URL (${new URL(e.AVSERV_BASE_URL).host}), the primary` };
  }
  const names = new Set(nodes.map((n) => n.name));
  for (const [name, value] of [
    ["AVSERV_BASE_URL", e.AVSERV_BASE_URL],
    ["AVSERV_FAILOVER_BASE_URL", e.AVSERV_FAILOVER_BASE_URL],
  ] as const) {
    if (value && !names.has(new URL(value).host)) {
      return { status: "error", error: `AVSERV_NODE_URLS doesn't list ${name} (${new URL(value).host})` };
    }
  }
  return { status: "ok", nodes: [...names] };
}
