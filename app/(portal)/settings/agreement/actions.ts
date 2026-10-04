"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { presentedAgreement } from "@/lib/agreement";
import { classifyAgreementError, reportAgreementFailure } from "@/lib/agreement/errors";
import { ALERT_NAME_MAX, codePointLength, LEGAL_NAME_MAX, normalizeName } from "@/lib/agreement/names";
import { portalActor } from "@/lib/auth/portal-actor";
import { acceptAgreement, type AcceptBody } from "@/lib/avserv/agreement";
import { browserIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";

// Web acceptance of the AvAI user agreement (AvServ plan 23; contract
// account_agreement.md rev 2 §3.3, §4; docs/plans/31 §3). Synchronous: the
// user sees AvServ's answer, and nothing is queued. The Idempotency-Key is
// minted by the page (one per user act) and arrives in the form, so a retry
// click after a transient failure is the same acceptance, not a second one.

export type AcceptAgreementResult =
  | { ok: true; activated: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

function requiredName(max: number, label: string) {
  return z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, `Enter ${label}.`)
        .refine((s) => codePointLength(s) <= max, `This can be at most ${max} characters.`),
    );
}

const acceptSchema = z.object({
  idempotencyKey: z.string().uuid(),
  version: z.string().min(1),
  displayedAt: z.string().datetime().optional(),
  presentedInFull: z.literal("true", { error: "Scroll to the end of the agreement first." }),
  assent: z.literal("on", { error: "Tick the box to agree." }),
  legalName: requiredName(LEGAL_NAME_MAX, "your legal name"),
  displayName: requiredName(ALERT_NAME_MAX, "the name on your alerts"),
});

const ATTESTATION_PREFIX = "attestation.";

const ACCEPT_RATE_LIMIT = { limit: 20, windowSec: 60 * 60 };

export async function acceptAgreementAction(
  _prev: AcceptAgreementResult | null,
  formData: FormData,
): Promise<AcceptAgreementResult> {
  const actor = await portalActor();
  if (!actor.ok) return { ok: false, error: actor.error };
  const userId = actor.userId;

  const presented = presentedAgreement();
  if (!presented) {
    return { ok: false, error: "The AvAI user agreement hasn't been published yet." };
  }

  const parsed = acceptSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    version: formData.get("version"),
    displayedAt: formData.get("displayedAt") || undefined,
    presentedInFull: formData.get("presentedInFull"),
    assent: formData.get("assent"),
    legalName: formData.get("legalName") ?? "",
    displayName: formData.get("displayName") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const form = parsed.data;
  if (form.version !== presented.version) {
    // The page was rendered by an older deploy; its text is not what we'd send.
    return { ok: false, error: "This page is out of date. Reload it and try again." };
  }

  const affirmed = new Set(
    [...formData.keys()]
      .filter((k) => k.startsWith(ATTESTATION_PREFIX) && formData.get(k) === "on")
      .map((k) => k.slice(ATTESTATION_PREFIX.length)),
  );
  const missing = presented.attestations.filter((a) => a.required && !affirmed.has(a.id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "Please confirm every required statement.",
      fieldErrors: Object.fromEntries(
        missing.map((a) => [`${ATTESTATION_PREFIX}${a.id}`, ["Required."]]),
      ),
    };
  }

  const [row] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.avservAccountId) {
    logger.warn({ event: "agreement.accept.no_account", userId });
    return {
      ok: false,
      error: "Your account isn't linked to AvAI yet. Sign out and back in, then try again.",
    };
  }

  // The browser's address is part of the acceptance record. Without it we
  // refuse rather than send a placeholder or our own address (contract §4).
  const ip = await browserIp();
  if (!ip) {
    logger.error({ event: "agreement.accept.no_browser_ip", userId });
    return {
      ok: false,
      error: "We couldn't verify your connection, so we can't record your acceptance. Please try again.",
    };
  }

  const rate = await incrementRateLimit(`avai-accept:${userId}`, ACCEPT_RATE_LIMIT);
  if (!rate.allowed) {
    logger.warn({ event: "agreement.accept.rate_limited", userId });
    return { ok: false, error: "Too many attempts in a short time. Please try again later." };
  }

  const h = await headers();
  const body: AcceptBody = {
    version: presented.version,
    contentHash: presented.contentHash,
    identity: { legalName: form.legalName, displayName: form.displayName },
    assent: {
      method: "checkbox_and_button",
      textHash: presented.assent.textHash,
      presentedInFull: true,
      ...(form.displayedAt ? { displayedAt: form.displayedAt } : {}),
      acceptedAt: new Date().toISOString(),
    },
    attestations: presented.attestations
      .filter((a) => affirmed.has(a.id))
      .map((a) => ({ id: a.id, textHash: a.textHash, value: true as const })),
    client: {
      ip,
      userAgent: h.get("user-agent") ?? "",
      locale: firstLanguageTag(h.get("accept-language")),
    },
  };

  try {
    const result = await acceptAgreement(row.avservAccountId, form.idempotencyKey, body);
    revalidatePath("/settings");
    revalidatePath("/settings/agreement");
    // No names or IP in the log: the acceptance id is the join key to AvServ's record.
    logger.info({
      event: "agreement.accepted",
      userId,
      acceptanceId: result.acceptanceId,
      version: result.version,
      activated: result.activated,
    });
    if (!result.activated) {
      // Reserved by the contract (§3.3: every accepted, non-retired version
      // activates today). If it ever appears, AvServ wants it reported.
      logger.error({ event: "agreement.accept.not_activated", userId, acceptanceId: result.acceptanceId });
    }
    return { ok: true, activated: result.activated };
  } catch (err) {
    const failure = classifyAgreementError(err);
    reportAgreementFailure("agreement.accept.failed", failure, err, {
      userId,
      version: presented.version,
    });
    return {
      ok: false,
      error: failure.message,
      ...(failure.field ? { fieldErrors: { [failure.field]: [failure.message] } } : {}),
    };
  }
}

// "en-US,en;q=0.9" → "en-US". AvServ records up to 35 printable characters.
function firstLanguageTag(header: string | null): string {
  const tag = header?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  return /^[A-Za-z0-9-]{1,35}$/.test(tag) ? tag : "";
}
