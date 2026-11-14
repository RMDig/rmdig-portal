"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageOrg } from "@/lib/auth/org-roles";
import { portalActor } from "@/lib/auth/portal-actor";
import { db } from "@/lib/db";
import { sarOrgSettingsLog, sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { reportError, reportProblem } from "@/lib/report-error";
import { capacityFieldSchema } from "@/lib/sar/capacity";
import { isPastTeam } from "@/lib/sar/team-status";
import { syncSarOrg } from "@/lib/sar/sync";

// A team's admins set its check-out settings (plan 33 9.7, 9.8;
// sar_team_sync.md §5): the most check-outs AvServ binds to the team at once
// (D5), and whether a user who accepts the team's terms may name it at once or
// only once the team approves (D4), and whether AvAI lists the team in nearby
// searches (AvApp plan 68, owner Q2d). Each change and its log row land in one
// transaction; the sync follows, and a node that fails is shown and resent by
// the node check (lib/sar/node-check.ts), never rolled back into the saved
// setting. A pending team's settings are sent once it is approved.

export type SaveSettingResult<T> =
  | { ok: true; value: T; sync: "sent" | "partial" | "later" | "unchanged" }
  | { ok: false; error: string; fieldError?: string };

const SYNCED = new Set(["approved", "leaving", "suspended"]);

class TeamClosed extends Error {}

type Setting =
  | { name: "max_active_checkouts"; value: number | null }
  | { name: "acceptance_mode"; value: "open" | "confirm_first" }
  | { name: "nearby_listing"; value: boolean };

const asText = (v: number | string | boolean | null) => (v === null ? null : typeof v === "boolean" ? (v ? "on" : "off") : String(v));

function currentValue(name: Setting["name"], row: { cap: number | null; mode: "open" | "confirm_first"; nearbyAt: Date | null }) {
  if (name === "max_active_checkouts") return row.cap;
  if (name === "acceptance_mode") return row.mode;
  return row.nearbyAt !== null;
}

function columns(setting: Setting) {
  if (setting.name === "max_active_checkouts") return { maxActiveCheckouts: setting.value };
  if (setting.name === "acceptance_mode") return { acceptanceMode: setting.value };
  // The consent's time is when it was turned on, sent as `consentAt`.
  return { nearbyListingAt: setting.value ? new Date() : null };
}

/** Save one setting: lock the team, refuse a team that is over, skip an
 *  unchanged value, write it and its log row, then sync. */
async function saveSetting<S extends Setting>(orgId: string, userId: string, setting: S): Promise<SaveSettingResult<S["value"]>> {
  let change: { status: string; from: S["value"] } | null;
  try {
    change = await db.transaction(async (tx) => {
      // Locked, so a concurrent withdrawal or a second edit can't interleave.
      const [row] = await tx
        .select({ status: sarOrgs.status, cap: sarOrgs.maxActiveCheckouts, mode: sarOrgs.acceptanceMode, nearbyAt: sarOrgs.nearbyListingAt })
        .from(sarOrgs)
        .where(eq(sarOrgs.id, orgId))
        .for("update")
        .limit(1);
      if (!row || isPastTeam(row.status)) throw new TeamClosed();
      const from = currentValue(setting.name, row) as S["value"];
      if (from === setting.value) return null;
      await tx.update(sarOrgs).set(columns(setting)).where(eq(sarOrgs.id, orgId));
      await tx.insert(sarOrgSettingsLog).values({ orgId, setting: setting.name, fromValue: asText(from), toValue: asText(setting.value), actorUserId: userId });
      return { status: row.status, from };
    });
  } catch (err) {
    if (err instanceof TeamClosed) return { ok: false, error: "This team isn't taking part any more, so it has no check-out settings." };
    logger.error({ event: "sar.settings.save_failed", userId, orgId, setting: setting.name, err });
    return { ok: false, error: "Couldn't save the setting. Try again in a moment." };
  }
  if (!change) return { ok: true, value: setting.value, sync: "unchanged" };
  logger.info({ event: "sar.settings.changed", userId, orgId, setting: setting.name, from: change.from, to: setting.value });

  const sync = SYNCED.has(change.status) ? await syncSettings(orgId, setting.name) : "later";
  // The layout's tabs follow the mode (Approvals), so refresh the team's pages.
  revalidatePath(`/sar/${orgId}`, "layout");
  return { ok: true, value: setting.value, sync };
}

/** The new setting goes to every node now. A node that fails is recorded per
 *  node by syncSarOrg, shown to staff and resent by the node check. */
async function syncSettings(orgId: string, setting: Setting["name"]): Promise<"sent" | "partial"> {
  try {
    const outcomes = await syncSarOrg(orgId);
    if (outcomes.length > 0 && outcomes.every((o) => o.outcome === "ok")) return "sent";
    reportProblem("sar.settings.sync_incomplete", "A team's new check-out setting didn't reach every AvServ node", {
      orgId,
      setting,
      outcomes: outcomes.map((o) => `${o.node}:${o.outcome === "error" ? o.code : o.outcome === "skipped" ? o.reason : "ok"}`).join(","),
    });
    return "partial";
  } catch (err) {
    reportError("sar.settings.sync_failed", err, { orgId, setting });
    return "partial";
  }
}

async function adminActor(orgId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const actor = await portalActor();
  if (!actor.ok) return actor;
  if (!(await canManageOrg(actor.userId, orgId))) return { ok: false, error: "Only your team's admins can change its check-out settings." };
  return actor;
}

export async function saveCapacityAction(orgId: string, _prev: SaveSettingResult<number | null> | null, formData: FormData): Promise<SaveSettingResult<number | null>> {
  const actor = await adminActor(orgId);
  if (!actor.ok) return actor;
  const parsed = capacityFieldSchema.safeParse(formData.get("maxActiveCheckouts") ?? "");
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Enter a whole number, or leave it blank for no limit.";
    return { ok: false, error: message, fieldError: message };
  }
  return saveSetting(orgId, actor.userId, { name: "max_active_checkouts", value: parsed.data });
}

const modeSchema = z.enum(["open", "confirm_first"]);

export async function saveAcceptanceModeAction(
  orgId: string,
  _prev: SaveSettingResult<"open" | "confirm_first"> | null,
  formData: FormData,
): Promise<SaveSettingResult<"open" | "confirm_first">> {
  const actor = await adminActor(orgId);
  if (!actor.ok) return actor;
  const parsed = modeSchema.safeParse(formData.get("acceptanceMode"));
  if (!parsed.success) return { ok: false, error: "Choose who can name your team." };
  return saveSetting(orgId, actor.userId, { name: "acceptance_mode", value: parsed.data });
}

export async function saveNearbyListingAction(orgId: string, _prev: SaveSettingResult<boolean> | null, formData: FormData): Promise<SaveSettingResult<boolean>> {
  const actor = await adminActor(orgId);
  if (!actor.ok) return actor;
  const parsed = z.enum(["on", "off"]).safeParse(formData.get("nearbyListing"));
  if (!parsed.success) return { ok: false, error: "Choose whether AvAI lists your team in nearby searches." };
  return saveSetting(orgId, actor.userId, { name: "nearby_listing", value: parsed.data === "on" });
}
