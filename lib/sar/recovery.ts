import { and, eq } from "drizzle-orm";

import { avservNodes, getSarTeam, readRemedy, type Remedy } from "../avserv/sar-teams";
import { db } from "../db";
import { orgMemberships, sarOrgs, sarOrgSync, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendSarTeamRecoveryEmail } from "../email/send";
import { logger } from "../logger";
import { reportError, reportProblem } from "../report-error";
import { shouldNotify, type NodeRecovery } from "./recovery-rules";

// Each node's own view of a team, read after every sync (plan 33 §6.9 F4;
// AvServ sar_team_sync.md §5.4, plan 41 §17.13): what would make the team
// usable again there (`remedy`), and the alerts it holds back until then
// (`waitingAlerts`). Stored per node in sar_org_sync, shown to the team and to
// staff, and emailed to the team's admins once per new remedy. A read that
// fails is recorded and reported, and keeps the last good view: never read
// as "usable".

export interface NodeRead {
  node: string;
  remedy: Remedy | null;
  waitingAlerts: number | null;
  error: string | null;
}

/** Read every node, record what each said, and email the admins about any
 *  new problem. Never throws: a sync's caller must not fail on it. */
export async function readTeamRecovery(orgId: string): Promise<NodeRead[]> {
  try {
    const reads = await Promise.all(avservNodes().map((node) => readNode(node, orgId)));
    await notifyAdmins(orgId);
    return reads;
  } catch (err) {
    reportError("sar.recovery.read_failed", err, { orgId });
    return [];
  }
}

async function readNode(node: ReturnType<typeof avservNodes>[number], orgId: string): Promise<NodeRead> {
  const now = new Date();
  let read: NodeRead;
  let extra: { activeCheckouts: number | null; overCapacity: boolean | null } = { activeCheckouts: null, overCapacity: null };
  try {
    const view = await getSarTeam(node, orgId);
    if (!view) {
      // The node never received the team: the sync's own record says why.
      read = { node: node.name, remedy: null, waitingAlerts: null, error: "team_unknown" };
    } else {
      read = { node: node.name, remedy: readRemedy(view.remedy, { node: node.name, orgId }), waitingAlerts: view.waitingAlerts ?? null, error: null };
      extra = { activeCheckouts: view.activeCheckouts ?? null, overCapacity: view.overCapacity ?? null };
      if (view.overCapacity) reportProblem("sar.recovery.over_capacity", "An AvServ node reports a team over its check-out limit", { orgId, node: node.name, activeCheckouts: view.activeCheckouts });
      // A node missing part of the team is the portal's to resend: staff see it.
      if (read.remedy === "resync") reportProblem("sar.recovery.resync_needed", "An AvServ node needs a SAR team resent", { orgId, node: node.name });
    }
  } catch (err) {
    logger.error({ event: "sar.recovery.node_read_failed", orgId, node: node.name, err });
    read = { node: node.name, remedy: null, waitingAlerts: null, error: (err as Error).message.slice(0, 200) };
  }

  const set =
    read.error === null
      ? { remedy: read.remedy, waitingAlerts: read.waitingAlerts, ...extra, viewReadAt: now, viewError: null, ...(read.remedy === null ? { remedyNotified: null } : {}) }
      : { viewReadAt: now, viewError: read.error };
  // The row exists once the node was synced; a read alone never creates one.
  await db.update(sarOrgSync).set(set).where(and(eq(sarOrgSync.orgId, orgId), eq(sarOrgSync.node, node.name)));
  if (read.remedy) logger.warn({ event: "sar.recovery.unusable", orgId, node: node.name, remedy: read.remedy, waitingAlerts: read.waitingAlerts });
  return read;
}

async function notifyAdmins(orgId: string): Promise<void> {
  const [org] = await db.select({ name: sarOrgs.name, status: sarOrgs.status, isDrill: sarOrgs.isDrill }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) return;
  const rows = await db
    .select({ node: sarOrgSync.node, remedy: sarOrgSync.remedy, waitingAlerts: sarOrgSync.waitingAlerts, remedyNotified: sarOrgSync.remedyNotified })
    .from(sarOrgSync)
    .where(eq(sarOrgSync.orgId, orgId));
  const news = rows.map((r) => ({ ...r, remedy: r.remedy as Remedy | null }) satisfies NodeRecovery).filter((r) => shouldNotify(org.status, r));
  if (news.length === 0) return;

  const admins = await db
    .select({ email: users.email })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "admin")));
  if (admins.length === 0) {
    // The no-admin email already tells staff; this says what it cost.
    reportProblem("sar.recovery.no_admin", "A SAR team AvServ can't use has no admin to tell", { orgId, nodes: news.map((n) => n.node).join(",") });
    return;
  }
  let sent = 0;
  for (const a of admins) {
    try {
      await sendSarTeamRecoveryEmail(a.email, {
        teamName: org.name,
        nodes: news.map((n) => ({ node: n.node, remedy: n.remedy!, waitingAlerts: n.waitingAlerts })),
        teamUrl: portalUrl(`/sar/${orgId}/members`),
        drill: org.isDrill,
      });
      sent++;
    } catch (err) {
      logger.error({ event: "sar.recovery.email_failed", orgId, to: a.email, err });
    }
  }
  // Marked only once someone was told, so a total failure is tried again on
  // the next read.
  if (sent === 0) {
    reportProblem("sar.recovery.email_undelivered", "No admin of a SAR team AvServ can't use could be emailed", { orgId });
    return;
  }
  for (const n of news) {
    await db.update(sarOrgSync).set({ remedyNotified: n.remedy }).where(and(eq(sarOrgSync.orgId, orgId), eq(sarOrgSync.node, n.node)));
  }
  logger.info({ event: "sar.recovery.notified", orgId, admins: sent, nodes: news.map((n) => `${n.node}:${n.remedy}`) });
}
