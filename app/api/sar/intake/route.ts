import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { orgMemberships, sarIntakeMessages, sarOrgs, users } from "@/lib/db/schema";
import { sendSarAlertNotifyEmail } from "@/lib/email/send";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntakePayload, parseIntakeKeys, verifySignature } from "@/lib/sar/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AvServ → portal SAR intake (AvServ sar_portal_intake.md). Answers per §3
// (as amended after the S3 audit): 2xx or 409 duplicate = delivered; 5xx, 401
// and 429 = retried (a 401 is clock skew or a key mid-rotation, which heal);
// any other 4xx = permanent (AvServ doesn't retry, and pages). So: anything
// wrong with the request is a 4xx, and only our own failures are 5xx. The
// message is stored before answering 2xx; member emails follow and never
// change the answer.

const MAX_BODY_BYTES = 256 * 1024;

function reply(status: number, code: string) {
  return NextResponse.json({ code }, { status });
}

export async function POST(req: Request) {
  let keys: Map<string, string>;
  try {
    keys = parseIntakeKeys(env.AVSERV_SAR_INTAKE_KEYS);
  } catch (err) {
    logger.error({ event: "sar.intake.keys_invalid", err });
    return reply(503, "intake_not_configured");
  }
  if (keys.size === 0) {
    logger.error({ event: "sar.intake.not_configured" });
    return reply(503, "intake_not_configured");
  }

  const rawBody = Buffer.from(await req.arrayBuffer());
  if (rawBody.length > MAX_BODY_BYTES) return reply(413, "too_large");

  const node = req.headers.get("x-avai-node");
  const check = verifySignature({
    keys,
    keyId: req.headers.get("x-avai-key-id"),
    header: req.headers.get("x-avai-signature"),
    rawBody,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) {
    logger.warn({ event: "sar.intake.rejected", code: check.code, node });
    return reply(401, check.code);
  }

  let payload: IntakePayload;
  try {
    const parsed = IntakePayload.safeParse(JSON.parse(rawBody.toString("utf8")));
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid payload");
    payload = parsed.data;
  } catch (err) {
    logger.warn({ event: "sar.intake.invalid_payload", node, err: (err as Error).message });
    return reply(400, "invalid_payload");
  }
  if (req.headers.get("idempotency-key") !== payload.messageId) {
    logger.warn({ event: "sar.intake.idempotency_mismatch", node, messageId: payload.messageId });
    return reply(400, "idempotency_key_mismatch");
  }

  try {
    const [team] = await db
      .select({ name: sarOrgs.name, status: sarOrgs.status })
      .from(sarOrgs)
      .where(eq(sarOrgs.id, payload.teamId))
      .limit(1);
    if (!team) {
      logger.error({ event: "sar.intake.unknown_team", teamId: payload.teamId, messageId: payload.messageId });
      return reply(404, "unknown_team");
    }
    if (team.status !== "approved" && team.status !== "leaving") {
      // AvServ shouldn't send to it; keep the record and say so loudly.
      logger.error({ event: "sar.intake.team_not_active", teamId: payload.teamId, status: team.status });
    }

    const inserted = await db
      .insert(sarIntakeMessages)
      .values({
        messageId: payload.messageId,
        alertId: payload.alertId,
        orgId: payload.teamId,
        kind: payload.kind,
        capability: payload.capability ?? null,
        node: payload.node,
        drill: payload.drill,
        sentAt: new Date(payload.sentAt),
        payload,
      })
      .onConflictDoNothing()
      .returning({ messageId: sarIntakeMessages.messageId });
    if (inserted.length === 0) return reply(409, "duplicate");

    logger.info({ event: "sar.intake.received", teamId: payload.teamId, kind: payload.kind, node: payload.node, drill: payload.drill });
    // Stored: from here the answer is 200 whatever happens to the emails, or
    // AvServ would retry a message we already hold.
    try {
      await notifyMembers(payload, team.name);
    } catch (err) {
      logger.error({ event: "sar.intake.notify_failed", teamId: payload.teamId, messageId: payload.messageId, err });
    }
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    logger.error({ event: "sar.intake.failed", messageId: payload.messageId, err });
    return reply(500, "intake_failed");
  }
}

// Members hear about alerts and their resolution; never about drills or
// duplicate notices (the page shows those). A failed email is logged, never
// turned into a non-2xx: the message is stored and visible in the portal.
async function notifyMembers(payload: IntakePayload, teamName: string): Promise<void> {
  if (payload.drill || payload.kind === "duplicate_disclaimer") return;
  // Only the first delivery of an alert emails; the other node's copy doesn't.
  if (payload.kind === "overdue" || payload.kind === "send_help") {
    const copies = await db
      .select({ id: sarIntakeMessages.messageId })
      .from(sarIntakeMessages)
      .where(eq(sarIntakeMessages.alertId, payload.alertId))
      .limit(2);
    if (copies.length > 1) return;
  }
  const members = await db
    .select({ email: users.email })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, payload.teamId));
  const alertsUrl = `${env.NEXTAUTH_URL ?? "https://rmdig.ai"}/sar/${payload.teamId}/alerts`;
  const results = await Promise.allSettled(
    members.map((m) => sendSarAlertNotifyEmail(m.email, { teamName, kind: payload.kind as "overdue" | "send_help" | "all_clear" | "disregard", alertsUrl })),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") logger.error({ event: "sar.intake.member_email_failed", teamId: payload.teamId, to: members[i]!.email, err: r.reason });
  });
}
