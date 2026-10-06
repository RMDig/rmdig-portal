import { z } from "zod";

import { avservFetch, failureCode, isMock } from "./request";
import type { AvServNode } from "./sar-teams";

// AvServ's data_share_log lookup (sar_feeds.md §4, AvServ #196): what ONE node
// disclosed to SAR teams about an account, for passing a deletion request on
// to the teams that received the data (AvServ plan 41 §10.3). Each node logs
// only what it sent, so the caller reads every node and merges
// (lib/deletion/share-log.ts). A node that can't answer is reported, never
// read as "nothing shared": AvServ answers 503 log_unavailable, not [].

export const ShareLogItem = z.object({
  at: z.string(),
  node: z.string(),
  teamId: z.string(),
  kind: z.enum(["dispatch", "feed_read"]),
  subject: z.string(),
  messageKind: z.string().nullable(),
  channel: z.string().nullable(),
  fields: z.array(z.string()),
  reader: z.string().nullable(),
  // Drill-sink traffic: never real disclosures, so never in a deletion notice.
  drill: z.boolean(),
});
export type ShareLogItem = z.infer<typeof ShareLogItem>;

const Page = z.object({ items: z.array(ShareLogItem), nextCursor: z.string().nullable() });
const ErrorBody = z.object({ code: z.string().optional() });

export type ShareLogResult = { ok: true; node: string; items: ShareLogItem[] } | { ok: false; node: string; code: string };

const PAGE_LIMIT = 500;
// 10,000 disclosures for one account is far past anything real; stopping
// there is reported as a failure rather than an incomplete list shown as whole.
const MAX_PAGES = 20;

export async function readShareLog(node: AvServNode, accountId: string): Promise<ShareLogResult> {
  if (isMock(node.baseUrl)) return { ok: true, node: node.name, items: [] };
  const items: ShareLogItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ accountId, limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) });
    let res: Response;
    try {
      res = await avservFetch(node.baseUrl, `/v1/internal/data-share-log?${qs}`, { method: "GET" });
    } catch (err) {
      return { ok: false, node: node.name, code: failureCode(err, { call: "share_log", node: node.name }) };
    }
    if (!res.ok) {
      const err = ErrorBody.safeParse(await res.json().catch(() => null));
      return { ok: false, node: node.name, code: (err.success && err.data.code) || `http_${res.status}` };
    }
    const parsed = Page.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, node: node.name, code: "bad_response" };
    items.push(...parsed.data.items);
    cursor = parsed.data.nextCursor;
    if (!cursor) return { ok: true, node: node.name, items };
  }
  return { ok: false, node: node.name, code: "too_many_pages" };
}
