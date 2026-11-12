"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { sarOrgSettingsLog, sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { reportError, reportProblem } from "@/lib/report-error";
import { capacityFieldSchema } from "@/lib/sar/capacity";
import { isPastTeam } from "@/lib/sar/team-status";
import { syncSarOrg } from "@/lib/sar/sync";

// A team's admins set the most check-outs AvServ binds to the team at once
// (plan 33 D5, 9.7; sar_team_sync.md §5). The change and its log row land in
// one transaction; the sync follows, and a node that fails is shown and
// retried by the node check (lib/sar/node-check.ts), never rolled back into
// the saved setting. A pending team's cap is sent once it is approved.

export type SaveCapacityResult =
  | { ok: true; cap: number | null; sync: "sent" | "partial" | "later" | "unchanged" }
  | { ok: false; error: string; fieldErrors?: { maxActiveCheckouts?: string[] } };

const SYNCED = new Set(["approved", "leaving", "suspended"]);

class TeamClosed extends Error {}

export async function saveCapacityAction(orgId: string, _prev: SaveCapacityResult | null, formData: FormData): Promise<SaveCapacityResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;
  if (!(await canManageOrg(userId, orgId))) return { ok: false, error: "Only your team's admins can change its check-out limit." };

  const parsed = capacityFieldSchema.safeParse(formData.get("maxActiveCheckouts") ?? "");
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a whole number, or leave it blank for no limit.";
    return { ok: false, error: message, fieldErrors: { maxActiveCheckouts: [message] } };
  }
  const cap = parsed.data;

  let change: { status: string; from: number | null } | null;
  try {
    change = await db.transaction(async (tx) => {
      // Locked, so a concurrent withdrawal or a second edit can't interleave.
      const [row] = await tx
        .select({ status: sarOrgs.status, cap: sarOrgs.maxActiveCheckouts })
        .from(sarOrgs)
        .where(eq(sarOrgs.id, orgId))
        .for("update")
        .limit(1);
      if (!row || isPastTeam(row.status)) throw new TeamClosed();
      if (row.cap === cap) return null;
      await tx.update(sarOrgs).set({ maxActiveCheckouts: cap }).where(eq(sarOrgs.id, orgId));
      await tx.insert(sarOrgSettingsLog).values({
        orgId,
        setting: "max_active_checkouts",
        fromValue: row.cap === null ? null : String(row.cap),
        toValue: cap === null ? null : String(cap),
        actorUserId: userId,
      });
      return { status: row.status, from: row.cap };
    });
  } catch (err) {
    if (err instanceof TeamClosed) return { ok: false, error: "This team isn't taking part any more, so it has no check-out limit to set." };
    logger.error({ event: "sar.capacity.save_failed", userId, orgId, err });
    return { ok: false, error: "Couldn't save the limit. Try again in a moment." };
  }
  if (!change) return { ok: true, cap, sync: "unchanged" };
  logger.info({ event: "sar.capacity.changed", userId, orgId, from: change.from, to: cap });

  const sync = SYNCED.has(change.status) ? await syncCapacity(orgId) : "later";
  revalidatePath(`/sar/${orgId}/checkouts`);
  return { ok: true, cap, sync };
}

/** The new limit goes to every node now. A node that fails is recorded per
 *  node by syncSarOrg, shown to staff and resent by the node check. */
async function syncCapacity(orgId: string): Promise<"sent" | "partial"> {
  try {
    const outcomes = await syncSarOrg(orgId);
    if (outcomes.length > 0 && outcomes.every((o) => o.outcome === "ok")) return "sent";
    reportProblem("sar.capacity.sync_incomplete", "A team's new check-out limit didn't reach every AvServ node", {
      orgId,
      outcomes: outcomes.map((o) => `${o.node}:${o.outcome === "error" ? o.code : o.outcome === "skipped" ? o.reason : "ok"}`).join(","),
    });
    return "partial";
  } catch (err) {
    reportError("sar.capacity.sync_failed", err, { orgId });
    return "partial";
  }
}
