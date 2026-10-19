import { and, eq, isNotNull } from "drizzle-orm";

import { NOTICES_READER, readFeeds } from "../avserv/security-events";
import { db } from "../db";
import { securityNoticeCursors, users } from "../db/schema";
import { portalUrl } from "../email/links";
import { sendSecurityNoticeEmail } from "../email/send";
import { formatMountain } from "../format/time";
import { logger } from "../logger";
import { reportError } from "../report-error";
import { isKnownKind } from "../avserv/security-events-types";

// Opt-in security notices to the account email (plan 36 §5.3; owner rule 2:
// off by default, because the inbox may be the abuser's). One vague email per
// change: that something happened and when, never what or to whom.
//
// Portal changes notify as they happen (notifySecurityChange, called after the
// change is committed). AvServ's changes notify from the daily cron
// (runSecurityNotices), which reads each node's feed from where it last left off.

/** After a security change made through the portal. A failed email is logged
 *  and reported but never undoes the change it announces (CLAUDE.md §3.2). */
export async function notifySecurityChange(userId: string, at: Date = new Date()): Promise<void> {
  try {
    const [user] = await db
      .select({ email: users.email, noticesAt: users.securityNoticesAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.noticesAt) return;
    await sendSecurityNoticeEmail(user.email, { whenText: formatMountain(at), securityUrl: portalUrl("/settings/security") });
  } catch (err) {
    reportError("security_notices.notify_failed", err, { userId });
  }
}

/** Turn notices on (starting from the current end of every AvServ feed, so no
 *  backlog is emailed) or off (forgetting the cursors). */
export async function setSecurityNotices(userId: string, accountId: string | null, on: boolean): Promise<void> {
  if (!on) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ securityNoticesAt: null }).where(eq(users.id, userId));
      await tx.delete(securityNoticeCursors).where(eq(securityNoticeCursors.userId, userId));
    });
    return;
  }
  const ends = accountId ? await readFeeds(accountId, NOTICES_READER) : [];
  await db.transaction(async (tx) => {
    await tx.update(users).set({ securityNoticesAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(securityNoticeCursors).where(eq(securityNoticeCursors.userId, userId));
    for (const r of ends) {
      // A node that didn't answer starts from its beginning next run; events
      // from before notices were on are filtered out by time (below).
      if (r.ok) await tx.insert(securityNoticeCursors).values({ userId, node: r.feed.node, cursor: r.feed.cursor });
    }
  });
}

export interface NoticeRunSummary {
  users: number;
  notified: number;
  failed: number;
}

/** The daily cron: for each opted-in user, read every node's feed from its
 *  cursor; one notice if anything new happened since the last read. */
export async function runSecurityNotices(now: Date = new Date()): Promise<NoticeRunSummary> {
  const optedIn = await db
    .select({ id: users.id, email: users.email, accountId: users.avservAccountId, noticesAt: users.securityNoticesAt })
    .from(users)
    .where(and(isNotNull(users.securityNoticesAt), isNotNull(users.avservAccountId)));

  const summary: NoticeRunSummary = { users: optedIn.length, notified: 0, failed: 0 };
  for (const u of optedIn) {
    if (!u.accountId || !u.noticesAt) continue;
    try {
      const rows = await db
        .select({ node: securityNoticeCursors.node, cursor: securityNoticeCursors.cursor, updatedAt: securityNoticeCursors.updatedAt })
        .from(securityNoticeCursors)
        .where(eq(securityNoticeCursors.userId, u.id));
      const prev = new Map(rows.map((r) => [r.node, r]));
      const results = await readFeeds(u.accountId, NOTICES_READER, new Map(rows.map((r) => [r.node, r.cursor])));

      let newest: string | null = null;
      for (const r of results) {
        if (!r.ok) continue;
        // Only what happened after this node was last read (and after notices
        // were turned on): a re-read page is never announced twice.
        const since = (prev.get(r.feed.node)?.updatedAt ?? u.noticesAt).toISOString();
        for (const e of r.feed.events) {
          if (isKnownKind(e.kind) && e.at > since && (!newest || e.at > newest)) newest = e.at;
        }
      }

      if (newest) {
        await sendSecurityNoticeEmail(u.email, {
          whenText: formatMountain(new Date(newest)),
          securityUrl: portalUrl("/settings/security"),
        });
        summary.notified++;
      }
      // Advance only the nodes that answered, after the email went out: a
      // failed send leaves the cursors, so tomorrow's run tries again.
      for (const r of results) {
        if (!r.ok) continue;
        await db
          .insert(securityNoticeCursors)
          .values({ userId: u.id, node: r.feed.node, cursor: r.feed.cursor, updatedAt: now })
          .onConflictDoUpdate({
            target: [securityNoticeCursors.userId, securityNoticeCursors.node],
            set: { cursor: r.feed.cursor, updatedAt: now },
          });
      }
    } catch (err) {
      summary.failed++;
      reportError("security_notices.user_failed", err, { userId: u.id });
    }
  }
  logger.info({ event: "security_notices.run", ...summary });
  return summary;
}
