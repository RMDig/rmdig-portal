import { env } from "../env";
import { logger } from "../logger";
import { AvServError, avservFetch, contractFailure, failureCode, isMock } from "./request";
import { avservNodes } from "./sar-teams";
import { mergeFeeds } from "./security-events-merge";
import { mockFeedPage } from "./security-events-mock";
import { FeedPageSchema, type AvServSecurityEvent, type FeedPage } from "./security-events-types";

// AvServ's per-account security feed (docs/contracts/security_events.md rev 1),
// read from EVERY node with the everyday key (group `security_events`) and an
// X-AvAI-Reader. Each node lists what it recorded; the merge dedupes on the
// action's id. Nothing plan 36 rule 3 keeps out ever arrives (contract §2).

const PAGE_LIMIT = 200;
// The security page reads from the start; this bounds one view (and one cron
// run) at 1000 events a node, about two years of a busy account.
const MAX_PAGES = 5;

/** The reader for the notice cron (contract §5). */
export const NOTICES_READER = "portal-user:automation:security-notices";

export interface NodeFeed {
  node: string;
  events: FeedPage["events"];
  /** The cursor to read from next time: the last non-null one seen. */
  cursor: string | null;
  /** Stopped at MAX_PAGES with more to read. */
  truncated: boolean;
}

async function fetchPage(baseUrl: string, node: string, accountId: string, cursor: string | null, reader: string): Promise<FeedPage> {
  if (isMock(baseUrl)) return mockFeedPage(accountId, cursor, PAGE_LIMIT);
  const q = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) q.set("cursor", cursor);
  const res = await avservFetch(baseUrl, `/v1/internal/accounts/${encodeURIComponent(accountId)}/security-events?${q}`, {
    method: "GET",
    headers: { "x-avai-reader": reader },
  });
  if (!res.ok) throw await contractFailure(res, false);
  const parsed = FeedPageSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    logger.error({ event: "avserv.security_events.bad_response", node });
    throw new AvServError("AvServ security-events response failed schema validation");
  }
  return parsed.data;
}

/** One node's feed from `cursor` (null = the start), up to MAX_PAGES. */
async function readNode(baseUrl: string, node: string, accountId: string, cursor: string | null, reader: string): Promise<NodeFeed> {
  const events: FeedPage["events"] = [];
  let at = cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await fetchPage(baseUrl, node, accountId, at, reader);
    events.push(...page.events);
    if (page.nextCursor === null || page.events.length === 0) return { node, events, cursor: at, truncated: false };
    at = page.nextCursor;
  }
  return { node, events, cursor: at, truncated: true };
}

export type NodeFeedResult = { ok: true; feed: NodeFeed } | { ok: false; node: string; code: string };

/** Every node's feed, each from its own cursor (absent = the start). */
export async function readFeeds(
  accountId: string,
  reader: string,
  cursors: ReadonlyMap<string, string | null> = new Map(),
): Promise<NodeFeedResult[]> {
  const nodes = env.AVSERV_BASE_URL ? avservNodes() : [];
  return Promise.all(
    nodes.map(async ({ name, baseUrl }): Promise<NodeFeedResult> => {
      try {
        return { ok: true, feed: await readNode(baseUrl, name, accountId, cursors.get(name) ?? null, reader) };
      } catch (err) {
        const code = err instanceof AvServError && err.code ? err.code : failureCode(err, { node: name, what: "security_events" });
        logger.warn({ event: "avserv.security_events.node_failed", node: name, code });
        return { ok: false, node: name, code };
      }
    }),
  );
}

export interface SecurityFeed {
  events: AvServSecurityEvent[];
  /** A node didn't answer, or a feed was longer than one view reads. */
  incomplete: boolean;
  /** No node answered at all. */
  failed: boolean;
}

/** The account's AvServ security events, newest first, for the security page. */
export async function readSecurityEvents(accountId: string, readerUserId: string): Promise<SecurityFeed> {
  const results = await readFeeds(accountId, `portal-user:${readerUserId}`);
  const ok = results.filter((r): r is Extract<NodeFeedResult, { ok: true }> => r.ok);
  const merged = mergeFeeds(ok.map((r) => r.feed.events));
  // Count only: the name of a kind the portal doesn't know is never logged.
  if (merged.unknownDropped > 0) logger.warn({ event: "security_events.unknown_kind_dropped", count: merged.unknownDropped });
  return {
    events: merged.events,
    incomplete: ok.length < results.length || ok.some((r) => r.feed.truncated),
    failed: results.length > 0 && ok.length === 0,
  };
}
