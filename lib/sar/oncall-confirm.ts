import { eq } from "drizzle-orm";

import { db } from "../db";
import { sarOncallEmailVerifications, sarOrgs } from "../db/schema";
import { hashOncallToken } from "./oncall-email";

// Reading and confirming a team's on-call link (plan 33 9.10). Shared by the
// page that shows what the link would confirm and the action that confirms it.

const LINK_COLUMNS = {
  id: sarOncallEmailVerifications.id,
  orgId: sarOncallEmailVerifications.orgId,
  address: sarOncallEmailVerifications.address,
  expires: sarOncallEmailVerifications.expires,
  confirmedAt: sarOncallEmailVerifications.confirmedAt,
  teamName: sarOrgs.name,
  status: sarOrgs.status,
  isDrill: sarOrgs.isDrill,
};

export type OncallLink =
  | { ok: true; verificationId: string; orgId: string; teamName: string; address: string; isDrill: boolean }
  | { ok: false; reason: "invalid" | "used" | "expired" | "team_closed" };

/** What a link would confirm, without confirming it. */
export async function readOncallLink(token: string, now: Date = new Date()): Promise<OncallLink> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, reason: "invalid" };
  const [row] = await db
    .select(LINK_COLUMNS)
    .from(sarOncallEmailVerifications)
    .innerJoin(sarOrgs, eq(sarOrgs.id, sarOncallEmailVerifications.orgId))
    .where(eq(sarOncallEmailVerifications.tokenHash, hashOncallToken(token)))
    .limit(1);
  return judge(row, now);
}

type Row = { id: string; orgId: string; address: string; expires: Date; confirmedAt: Date | null; teamName: string; status: string; isDrill: boolean };

function judge(row: Row | undefined, now: Date): OncallLink {
  if (!row) return { ok: false, reason: "invalid" };
  if (row.confirmedAt) return { ok: false, reason: "used" };
  if (row.expires.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.status !== "pending" && row.status !== "approved") return { ok: false, reason: "team_closed" };
  return { ok: true, verificationId: row.id, orgId: row.orgId, teamName: row.teamName, address: row.address, isDrill: row.isDrill };
}

/** Confirm the link: the team's on-call address becomes this one. Checked
 *  again under a row lock, so a link is used once. */
export async function confirmOncallLink(token: string, now: Date = new Date()): Promise<OncallLink> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(LINK_COLUMNS)
      .from(sarOncallEmailVerifications)
      .innerJoin(sarOrgs, eq(sarOrgs.id, sarOncallEmailVerifications.orgId))
      .where(eq(sarOncallEmailVerifications.tokenHash, hashOncallToken(token)))
      .for("update")
      .limit(1);
    const link = judge(row, now);
    if (!link.ok) return link;
    await tx.update(sarOrgs).set({ oncallEmail: link.address, oncallEmailVerifiedAt: now }).where(eq(sarOrgs.id, link.orgId));
    await tx.update(sarOncallEmailVerifications).set({ confirmedAt: now }).where(eq(sarOncallEmailVerifications.id, link.verificationId));
    return link;
  });
}

export const ONCALL_LINK_PROBLEM: Record<Exclude<OncallLink, { ok: true }>["reason"], string> = {
  invalid: "This link isn't valid. Ask your team's admin to send a new one from the team's Terms page.",
  used: "This address was already confirmed with this link.",
  expired: "This link has expired. Ask your team's admin to send a new one from the team's Terms page.",
  team_closed: "This team can't change its on-call email right now. Contact rmdig support.",
};
