import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "../db";
import { orgMemberships, sarIntakeMessages, sarOrgs, users } from "../db/schema";
import { sendSarAlertNotifyEmail } from "../email/send";
import { env } from "../env";
import { logger } from "../logger";
import { type IntakePayload, parseIntakeKeys, parseIntakePayload, verifySignature } from "./intake";

// AvServ → portal SAR intake (AvServ sar_portal_intake.md), shared by the live
// route (app/api/sar/intake) and the drill route (app/api/sar/intake/drill).
// Two walls keep them apart: a node in drill mode sends only to the drill URL
// and marks every message drill: true; here, the live URL refuses a drill
// message and the drill URL refuses a live one, each with a permanent 4xx so
// AvServ pages instead of a drill reaching a team as real (or the reverse).
// Answers per §3
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

export type IntakeMode = "live" | "drill";

export async function handleIntake(req: Request, mode: IntakeMode) {
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
    const parsed = parseIntakePayload(JSON.parse(rawBody.toString("utf8")));
    if (!parsed.ok) throw new Error(parsed.error);
    payload = parsed.payload;
    if (parsed.dropped.length) {
      // Accepted without those details: off-contract from AvServ, so loud, but
      // never a reason to withhold the alert from the team.
      logger.error({ event: "sar.intake.fields_dropped", node, messageId: payload.messageId, fields: parsed.dropped });
    }
  } catch (err) {
    logger.warn({ event: "sar.intake.invalid_payload", node, err: (err as Error).message });
    return reply(400, "invalid_payload");
  }
  if (req.headers.get("idempotency-key") !== payload.messageId) {
    logger.warn({ event: "sar.intake.idempotency_mismatch", node, messageId: payload.messageId });
    return reply(400, "idempotency_key_mismatch");
  }
  if (payload.drill !== (mode === "drill")) {
    const code = payload.drill ? "drill_on_live_intake" : "live_on_drill_intake";
    logger.error({ event: "sar.intake.wrong_url", code, node, messageId: payload.messageId });
    return reply(400, code);
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

    logger.info({ event: "sar.intake.received", mode, teamId: payload.teamId, kind: payload.kind, node: payload.node });
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
  // Only the first delivery emails; the other node's copy of the same alert or
  // update (same alertId and kind, sar_portal_intake.md) doesn't.
  const copies = await db
    .select({ id: sarIntakeMessages.messageId })
    .from(sarIntakeMessages)
    .where(and(eq(sarIntakeMessages.alertId, payload.alertId), eq(sarIntakeMessages.kind, payload.kind)))
    .limit(2);
  if (copies.length > 1) return;
  // Only the roles that can open the alerts page and act on it (owner
  // decision 2026-10-06): a responder couldn't follow the email's link.
  const members = await db
    .select({ email: users.email })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, payload.teamId), inArray(orgMemberships.role, ["admin", "dispatcher"])));
  const alertsUrl = `${env.NEXTAUTH_URL ?? "https://rmdig.ai"}/sar/${payload.teamId}/alerts`;
  const results = await Promise.allSettled(
    members.map((m) => sendSarAlertNotifyEmail(m.email, {
        teamName,
        kind: payload.kind as "overdue" | "send_help" | "all_clear" | "disregard",
        fromAreaUser: payload.capability === "send_help_area",
        alertsUrl,
      })),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") logger.error({ event: "sar.intake.member_email_failed", teamId: payload.teamId, to: members[i]!.email, err: r.reason });
  });
}
