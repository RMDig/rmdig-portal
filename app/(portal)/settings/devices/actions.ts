"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { portalActor } from "@/lib/auth/portal-actor";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { notifySecurityChange } from "@/lib/auth/security-notices";
import {
  deviceRevokeAvailable,
  revokeDevice,
  revokeOtherDevices,
  revokePreview,
} from "@/lib/avserv/device-revoke";
import {
  mergePreviews,
  summarizeRevoke,
  summarizeRevokeOthers,
  type LiveSummary,
  type RevokeOutcome,
} from "@/lib/avserv/device-revoke-merge";
import {
  predictRevokeMode,
  REVOKE_REASONS,
  type AuthStrength,
  type RevokeMode,
} from "@/lib/avserv/device-revoke-types";
import type { SessionAuthMethod } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatMountain } from "@/lib/format/time";
import { logger } from "@/lib/logger";

// Signing a phone out (plan 36 §5.1; AvServ device_revoke.md rev 2). Every
// step needs a recent login, the preview included: it tells whoever reads it
// whether a trip is under way (rule 1). The revoke never cuts Send Help.

const REAUTH = {
  ok: false as const,
  reauth: true as const,
  error: "For your security, confirm it's you before signing a phone out.",
};
const UNAVAILABLE = { ok: false as const, error: "Signing a phone out isn't available yet." };

type Failure = { ok: false; error: string; reauth?: true };

/** How this session last proved who it is, as AvServ's authStrength (§3.3). */
function authStrengthFor(method: SessionAuthMethod | null): AuthStrength {
  // Passkeys arrive in plan 36 PR 10, with their enrolment time.
  return method === "password" ? { method: "password" } : { method: "other" };
}

type Ready =
  | { ok: true; userId: string; accountId: string; strength: AuthStrength }
  | Failure;

async function ready(): Promise<Ready> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!deviceRevokeAvailable()) return UNAVAILABLE;
  const [row] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  if (!row?.avservAccountId) {
    return { ok: false, error: "Your account isn't linked to the device service yet. Sign out and back in, then try again." };
  }
  const recent = await requireRecentAuth(actor.userId);
  if (!recent.ok) return REAUTH;
  return { ok: true, userId: actor.userId, accountId: row.avservAccountId, strength: authStrengthFor(recent.authMethod) };
}

const deviceId = z.string().uuid();

export type PreviewResult =
  | { ok: true; live: LiveSummary; dueText: string | null; revoked: boolean; incomplete: boolean; mode: RevokeMode }
  | Failure;

export async function previewRevokeAction(rawDeviceId: string): Promise<PreviewResult> {
  const id = deviceId.safeParse(rawDeviceId);
  if (!id.success) return { ok: false, error: "That phone couldn't be found." };
  const r = await ready();
  if (!r.ok) return r;

  const merged = mergePreviews(await revokePreview(r.accountId, id.data, r.userId));
  if (merged.failed) {
    logger.warn({ event: "devices.revoke_preview.no_node", userId: r.userId });
    return { ok: false, error: "Couldn't reach the device service. Nothing changed. Try again in a moment." };
  }
  return {
    ok: true,
    live: merged.live,
    // Formatted here, in Mountain time like every portal date.
    dueText: merged.live.nextDueAt ? formatMountain(new Date(merged.live.nextDueAt)) : null,
    revoked: merged.revoked,
    incomplete: merged.incomplete,
    mode: predictRevokeMode(r.strength, new Date()),
  };
}

export type RevokeResult = { ok: true; status: "done" | "partial"; message: string } | Failure | null;

function outcomeMessage(o: RevokeOutcome, what: string): RevokeResult {
  if (o.status === "failed") {
    return { ok: false, error: "Couldn't reach the device service. Nothing changed. Try again in a moment." };
  }
  if (o.status === "partial") {
    return {
      ok: true,
      status: "partial",
      message: `${what} on one server; the other didn't answer. It will catch up. You can try again to make sure.`,
    };
  }
  return { ok: true, status: "done", message: `${what}. Send Help still works from it.` };
}

const revokeSchema = z.object({ deviceId, reason: z.enum(REVOKE_REASONS) });

export async function revokeDeviceAction(_prev: RevokeResult, formData: FormData): Promise<RevokeResult> {
  const parsed = revokeSchema.safeParse({ deviceId: formData.get("deviceId"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, error: "Choose why you're signing this phone out." };
  const r = await ready();
  if (!r.ok) return r;

  const answers = await revokeDevice(r.accountId, parsed.data.deviceId, { reason: parsed.data.reason, authStrength: r.strength }, r.userId);
  const outcome = summarizeRevoke(answers);
  for (const node of outcome.missingNodes) logger.warn({ event: "devices.revoke.node_missing", userId: r.userId, node });
  logger.info({ event: "devices.revoked", userId: r.userId, status: outcome.status, mode: outcome.mode });
  if (outcome.status !== "failed") await notifySecurityChange(r.userId);
  revalidatePath("/settings/devices");
  return outcomeMessage(outcome, "Signed out");
}

const othersSchema = z.object({ keep: z.union([deviceId, z.literal("none")]) });

export async function revokeOtherDevicesAction(_prev: RevokeResult, formData: FormData): Promise<RevokeResult> {
  const parsed = othersSchema.safeParse({ keep: formData.get("keep") });
  if (!parsed.success) return { ok: false, error: "Choose the phone to keep, or None." };
  const r = await ready();
  if (!r.ok) return r;

  // keepDeviceId is always sent; null means "keep none" (rev 2 §3.4).
  const keepDeviceId = parsed.data.keep === "none" ? null : parsed.data.keep;
  const answers = await revokeOtherDevices(r.accountId, { keepDeviceId, reason: "user", authStrength: r.strength }, r.userId);
  const outcome = summarizeRevokeOthers(answers);
  for (const node of outcome.missingNodes) logger.warn({ event: "devices.revoke_others.node_missing", userId: r.userId, node });
  logger.info({ event: "devices.revoked_others", userId: r.userId, status: outcome.status, devices: outcome.devices });
  if (outcome.status !== "failed" && outcome.devices > 0) await notifySecurityChange(r.userId);
  revalidatePath("/settings/devices");
  if (outcome.keepRefused && outcome.status !== "done") {
    return {
      ok: false,
      error: "A server doesn't know the phone you chose to keep yet, so it signed nothing out. Try again in a minute.",
    };
  }
  if (outcome.status === "done" && outcome.devices === 0) {
    return { ok: true, status: "done", message: "There were no other phones to sign out." };
  }
  return outcomeMessage(outcome, `Signed out ${outcome.devices} ${outcome.devices === 1 ? "phone" : "phones"}`);
}
