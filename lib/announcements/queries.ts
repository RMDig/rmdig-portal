import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import { db } from "../db";
import { advertiserMemberships, announcements, orgMemberships } from "../db/schema";
import { audiencesOf, shownTo, type Audience } from "./announcements";

export type LiveAnnouncement = Pick<
  typeof announcements.$inferSelect,
  "id" | "message" | "severity" | "audiences" | "endsAt"
>;

/** Announcements live right now, newest first, before audience filtering. */
export async function liveAnnouncements(now = new Date()): Promise<LiveAnnouncement[]> {
  return db
    .select({
      id: announcements.id,
      message: announcements.message,
      severity: announcements.severity,
      audiences: announcements.audiences,
      endsAt: announcements.endsAt,
    })
    .from(announcements)
    .where(
      and(
        isNull(announcements.endedAt),
        or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
        or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
      ),
    )
    .orderBy(desc(announcements.createdAt))
    .limit(5);
}

/** The audiences a signed-in user belongs to. Membership is only read when
 *  something is live, so the usual page load costs one indexed query. */
export async function viewerAudiences(userId: string, isStaff: boolean): Promise<Set<Audience>> {
  const [sar, adv] = await Promise.all([
    // Every org role the user holds (one row per org), to tell admins apart.
    db.select({ role: orgMemberships.role }).from(orgMemberships).where(eq(orgMemberships.userId, userId)).limit(50),
    db
      .select({ u: advertiserMemberships.userId })
      .from(advertiserMemberships)
      .where(eq(advertiserMemberships.userId, userId))
      .limit(1),
  ]);
  return audiencesOf({
    isStaff,
    isSar: sar.length > 0,
    isSarAdmin: sar.some((m) => m.role === "admin"),
    isAdvertiser: adv.length > 0,
  });
}

export async function announcementsFor(userId: string, isStaff: boolean): Promise<LiveAnnouncement[]> {
  const live = await liveAnnouncements();
  if (live.length === 0) return [];
  const viewer = await viewerAudiences(userId, isStaff);
  return live.filter((a) => shownTo(a, viewer));
}
