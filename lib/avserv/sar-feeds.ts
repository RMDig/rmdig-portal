import { z } from "zod";

import { mockRedFeed } from "./sar-feeds-mock";
import type { AvServNode } from "./sar-teams";
import { avservFetch, failureCode, isMock } from "./request";

// AvServ's RED map feed (sar_feeds.md §1): alerts dispatched to one team, read
// from ONE node. The caller reads every node and merges (lib/map/red.ts). A
// node that can't answer is reported as unavailable, never as "no alerts":
// an empty map that is really an outage is the failure this contract exists
// to prevent.

// Unknown accuracy or time keeps the fix (older app builds send no time), and
// an unknown name keeps the item: one item's missing detail must never fail
// the node's whole feed.
const unknownAsNull = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => v ?? null);
const Fix = z.object({ lat: z.number(), lon: z.number(), accuracyMeters: unknownAsNull(z.number()), at: unknownAsNull(z.string()) });
const MultiLineString = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(z.array(z.number()).min(2))),
});

export const RedItem = z.object({
  itemId: z.string().min(1),
  kind: z.enum(["overdue", "send_help", "incident"]),
  status: z.enum(["open", "resolved", "retracted"]),
  userDisplayName: unknownAsNull(z.string()).transform((v) => (v && v.trim() ? v : null)),
  // Withheld (null) once an item has been resolved for more than 24 h.
  lastFix: Fix.nullable(),
  plannedRoute: MultiLineString.nullable(),
  expectedReturnAt: z.string().nullable(),
  note: z.string().nullable(),
  deliveries: z.array(
    z.object({ node: z.string(), ledgerKey: z.string(), channels: z.array(z.string()), deliveredAt: z.string() }),
  ),
  ack: z.object({ at: z.string(), by: z.string() }).nullable(),
  openedAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type RedItem = z.infer<typeof RedItem>;

const Page = z.object({ items: z.array(RedItem), nextCursor: z.string().nullable(), asOf: z.string() });
const ErrorBody = z.object({ code: z.string().optional() });

export type RedFeedResult =
  | { ok: true; node: string; items: RedItem[]; asOf: string }
  | { ok: false; node: string; code: string };

const PAGE_LIMIT = 200;
// 1,000 alerts for one team is far past anything real; stopping there is
// reported as a failure rather than showing a silently truncated map.
const MAX_PAGES = 5;

/** The team's RED feed from one node, all pages. `reader` is the viewing
 *  member (`portal-user:<id>`); AvServ logs the disclosure against it. */
export async function readRedFeed(node: AvServNode, orgId: string, readerUserId: string): Promise<RedFeedResult> {
  if (isMock(node.baseUrl)) return { ok: true, node: node.name, items: await mockRedFeed(orgId), asOf: new Date().toISOString() };
  const items: RedItem[] = [];
  let cursor: string | null = null;
  let asOf = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) });
    let res: Response;
    try {
      res = await avservFetch(node.baseUrl, `/v1/internal/sar-teams/${encodeURIComponent(orgId)}/alerts?${qs}`, {
        method: "GET",
        headers: { "x-avai-reader": `portal-user:${readerUserId}` },
      });
    } catch (err) {
      // No answer from this node (timeout, DNS, refused): the merge shows the
      // other node's answer with an "unavailable" marker. A fault of ours
      // (e.g. the signing key) is reported as itself.
      return { ok: false, node: node.name, code: failureCode(err, { call: "red_feed", node: node.name }) };
    }
    if (!res.ok) {
      const err = ErrorBody.safeParse(await res.json().catch(() => null));
      return { ok: false, node: node.name, code: (err.success && err.data.code) || `http_${res.status}` };
    }
    const parsed = Page.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, node: node.name, code: "bad_response" };
    items.push(...parsed.data.items);
    asOf ||= parsed.data.asOf;
    cursor = parsed.data.nextCursor;
    if (!cursor) return { ok: true, node: node.name, items, asOf };
  }
  return { ok: false, node: node.name, code: "too_many_pages" };
}
