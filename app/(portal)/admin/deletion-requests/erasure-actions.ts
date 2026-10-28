"use server";

import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { mfaIsOn } from "@/lib/auth/passkeys";
import { portalActor } from "@/lib/auth/portal-actor";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { hasPlatformRole } from "@/lib/auth/roles";
import { eraseOnPrimary, erasureAvailable, erasureStatusEveryNode, previewErasureEveryNode } from "@/lib/avserv/erasure";
import { db } from "@/lib/db";
import { deletionRequests } from "@/lib/db/schema";
import {
  completionNoteText,
  eraseOutcome,
  previewVerdict,
  statusSummary,
  type EraseOutcome,
  type PreviewVerdict,
  type StatusSummary,
} from "@/lib/deletion/erasure";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// The operator's "Erase in AvServ" (portal plan 35 D6, the manual path; AvServ
// account_erasure.md rev 1). A person clicks every step: rmdig admins only,
// behind two-factor and a recent login, named to AvServ as the reader. It
// replaces the runbook's SSH commands, not its judgement: the preview on every
// node gates the erase, the operator re-types the account id, and a refusal
// that means "this isn't the requester's account" stops for review.

const REAUTH = { ok: false as const, reauth: true as const, error: "Confirm it's you before erasing an account." };

// In front of AvServ's own 5 a day per node.
const ERASE_LIMIT = { limit: 5, windowSec: 24 * 60 * 60 };

type Failure = { ok: false; error: string; reauth?: true };

const Ids = z.object({
  requestId: z.string().uuid(),
  accountId: z.string().uuid("Enter the AvAI account id (a UUID)."),
});

type Ready =
  | { ok: true; userId: string; requestId: string; accountId: string; email: string; confirmedAt: Date }
  | Failure;

async function ready(formData: FormData): Promise<Ready> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!(await hasPlatformRole(actor.userId, "rmdig_admin"))) {
    return { ok: false, error: "Only a platform administrator can erase an account." };
  }
  if (!erasureAvailable()) return { ok: false, error: "Erasure from the portal isn't set up. Erase by hand (runbook)." };
  const parsed = Ids.safeParse({ requestId: formData.get("requestId"), accountId: formData.get("accountId") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (!(await mfaIsOn(actor.userId))) return { ok: false, error: "Turn on two-factor authentication first." };
  if (!(await requireRecentAuth(actor.userId)).ok) return REAUTH;
  const [request] = await db
    .select({ email: deletionRequests.email, confirmedAt: deletionRequests.confirmedAt })
    .from(deletionRequests)
    .where(and(eq(deletionRequests.id, parsed.data.requestId), eq(deletionRequests.status, "confirmed")))
    .limit(1);
  if (!request?.confirmedAt) return { ok: false, error: "That request isn't in the confirmed queue." };
  return { ok: true, userId: actor.userId, ...parsed.data, email: request.email, confirmedAt: request.confirmedAt };
}

export type PreviewResult = { ok: true; verdict: PreviewVerdict } | Failure;

export async function previewErasureAction(_prev: PreviewResult | null, formData: FormData): Promise<PreviewResult> {
  const r = await ready(formData);
  if (!r.ok) return r;
  const verdict = previewVerdict(await previewErasureEveryNode(r.accountId, r.userId));
  logger.info({
    event: "deletion.erasure.preview",
    requestId: r.requestId,
    staffId: r.userId,
    canErase: verdict.canErase,
    nodes: verdict.nodes.map((n) => `${n.node}:${n.state}`),
  });
  return { ok: true, verdict };
}

export type EraseResult =
  | { ok: true; outcome: EraseOutcome; status?: StatusSummary; note?: string; verdict?: PreviewVerdict }
  | Failure;

export async function eraseAccountAction(_prev: EraseResult | null, formData: FormData): Promise<EraseResult> {
  const r = await ready(formData);
  if (!r.ok) return r;
  if (String(formData.get("confirmAccountId") ?? "").trim() !== r.accountId) {
    return { ok: false, error: "Type the account id exactly to confirm." };
  }

  // The preview again, here: the button's state is the browser's, and live
  // safety state can start at any moment.
  const verdict = previewVerdict(await previewErasureEveryNode(r.accountId, r.userId));
  if (!verdict.canErase) {
    logger.warn({ event: "deletion.erasure.refused_preview", requestId: r.requestId, staffId: r.userId });
    return { ok: true, outcome: { kind: "later", code: "preview_changed" }, verdict };
  }
  if (!(await incrementRateLimit("avserv-erasure:portal", ERASE_LIMIT)).allowed) {
    logger.warn({ event: "deletion.erasure.rate_limited", requestId: r.requestId, staffId: r.userId });
    return { ok: false, error: "The portal's limit of 5 erasures a day is reached. Try again tomorrow." };
  }

  const outcome = eraseOutcome(
    await eraseOnPrimary(
      r.accountId,
      { requestRef: r.requestId, email: r.email, confirmedAt: r.confirmedAt.toISOString() },
      r.userId,
    ),
  );
  const context = { requestId: r.requestId, accountId: r.accountId, staffId: r.userId, outcome: outcome.kind };
  if (outcome.kind === "stop") {
    // The account isn't this requester's, or is newer than the request.
    // AvServ pages too. Nothing was erased; this needs a person's review.
    logger.error({ event: "deletion.erasure.stop", ...context, code: outcome.code });
    Sentry.captureMessage(`AvServ refused an erasure: ${outcome.code}`, {
      level: "error",
      tags: { event: "deletion.erasure.stop", code: outcome.code },
    });
    return { ok: true, outcome };
  }
  if (outcome.kind === "fault") {
    logger.error({ event: "deletion.erasure.fault", ...context, code: outcome.code, status: outcome.status });
    Sentry.captureMessage(`AvServ erasure failed on our side: ${outcome.code}`, {
      level: "error",
      tags: { event: "deletion.erasure.fault" },
    });
    return { ok: true, outcome };
  }
  if (outcome.kind === "blocked" || outcome.kind === "later") {
    logger.warn({ event: "deletion.erasure.not_now", ...context, ...(outcome.kind === "later" ? { code: outcome.code } : {}) });
    return { ok: true, outcome };
  }
  // Erased, or unknown: either way, what every node now holds is the answer.
  if (outcome.kind === "erased") logger.info({ event: "deletion.erasure.erased", ...context, origin: outcome.record.originNode });
  else logger.warn({ event: "deletion.erasure.unknown", ...context });
  const status = statusSummary(await erasureStatusEveryNode(r.accountId, r.userId));
  return { ok: true, outcome, status, note: completionNoteText(r.accountId, status) };
}

export type StatusResult = { ok: true; status: StatusSummary; note: string } | Failure;

export async function erasureStatusAction(_prev: StatusResult | null, formData: FormData): Promise<StatusResult> {
  const r = await ready(formData);
  if (!r.ok) return r;
  const status = statusSummary(await erasureStatusEveryNode(r.accountId, r.userId));
  logger.info({ event: "deletion.erasure.status", requestId: r.requestId, staffId: r.userId, overall: status.overall });
  return { ok: true, status, note: completionNoteText(r.accountId, status) };
}
