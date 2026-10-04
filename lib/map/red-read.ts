import { readRedFeed } from "../avserv/sar-feeds";
import { avservNodes } from "../avserv/sar-teams";
import { db } from "../db";
import { sarMapViewLog } from "../db/schema";
import { logger } from "../logger";
import type { MapLayer } from "./layers";
import { mergeRedFeeds, redLayer } from "./red";

// The RED layers for /map (server only): alerts AvAI sent to each of the
// viewer's teams (plan 33 §4), read from every AvServ node and merged. Each
// view is logged before it's returned, and a failed log write fails the page:
// nothing is shown that wasn't recorded. A failed read logs loudly and renders
// as an explicit error state, never an empty layer.
export async function loadRedLayers(userId: string, orgs: Array<{ id: string; name: string }>): Promise<MapLayer[]> {
  const nodes = avservNodes();
  if (nodes.length === 0 && orgs.length > 0) logger.error({ event: "sar.map.no_avserv_nodes" });
  const now = new Date();
  return Promise.all(
    orgs.map(async (org) => {
      const merged = mergeRedFeeds(await Promise.all(nodes.map((n) => readRedFeed(n, org.id, userId))));
      for (const u of merged.unavailable) {
        logger.error({ event: "sar.map.red_node_failed", orgId: org.id, node: u.node, code: u.code });
      }
      if (merged.status !== "error") {
        await db.insert(sarMapViewLog).values({
          orgId: org.id,
          userId,
          itemIds: merged.items.map((i) => i.itemId),
          nodes: nodes.map((n) => n.name).filter((n) => !merged.unavailable.some((u) => u.node === n)),
        });
      }
      return redLayer(org, merged, now);
    }),
  );
}
