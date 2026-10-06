// The public /status page's checks: is each AvAI alert server answering its
// public readiness check? No session, no database (CLAUDE.md §3.7), and
// cached (the page revalidates every 60 s) so crawlers and a spike of "is it
// down?" visits can't load the servers.

export type NodeCheck = { name: string; up: boolean };
export type Overall = "up" | "partial" | "down" | "unchecked";

const TIMEOUT_MS = 5000;

/** The configured AvServ nodes as public base URLs, in order; mock or unset
 *  (local, previews) gives none. */
export function nodeBases(primary: string | undefined, failover: string | undefined): string[] {
  return [primary, failover].filter((u): u is string => !!u && /^https?:\/\//.test(u));
}

export async function checkNodes(bases: string[], fetcher: typeof fetch = fetch): Promise<NodeCheck[]> {
  return Promise.all(
    bases.map(async (base, i) => {
      const name = `Alert server ${i + 1}`;
      try {
        const res = await fetcher(`${base.replace(/\/$/, "")}/readyz`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          next: { revalidate: 60 },
        } as RequestInit);
        return { name, up: res.ok };
      } catch {
        // No answer within the timeout is exactly what this page reports.
        return { name, up: false };
      }
    }),
  );
}

export function overall(nodes: NodeCheck[]): Overall {
  if (nodes.length === 0) return "unchecked";
  const up = nodes.filter((n) => n.up).length;
  return up === nodes.length ? "up" : up === 0 ? "down" : "partial";
}
