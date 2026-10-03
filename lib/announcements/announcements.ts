import { z } from "zod";

import type { announcementAudience, announcementSeverity } from "../db/schema";
import { FORBIDDEN_PUBLIC_PHRASES } from "../legal/compliance-copy";

// Pure rules for portal announcements: who sees one, when it's live, and what
// staff may write. lib/announcements/queries.ts and the admin actions feed
// them; everything here is unit-tested.

export type Audience = (typeof announcementAudience.enumValues)[number];
export type Severity = (typeof announcementSeverity.enumValues)[number];

export const AUDIENCES: readonly Audience[] = ["everyone", "explorer", "sar", "sar_admin", "advertiser", "staff"];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: "Everyone signed in",
  explorer: "Regular users",
  sar: "SAR organization members",
  sar_admin: "SAR organization admins",
  advertiser: "Advertisers",
  staff: "rmdig staff",
};
export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Information",
  maintenance: "Maintenance",
  incident: "Incident",
};

export interface Viewer {
  isStaff: boolean;
  isSar: boolean;
  /** Holds the `admin` role in at least one SAR org (dispatchers and
   *  responders don't). Implies isSar. */
  isSarAdmin: boolean;
  isAdvertiser: boolean;
}

/** The audiences a viewer belongs to. "explorer" means none of the roles. */
export function audiencesOf(v: Viewer): Set<Audience> {
  const set = new Set<Audience>(["everyone"]);
  if (v.isStaff) set.add("staff");
  if (v.isSar || v.isSarAdmin) set.add("sar");
  if (v.isSarAdmin) set.add("sar_admin");
  if (v.isAdvertiser) set.add("advertiser");
  if (!v.isStaff && !v.isSar && !v.isSarAdmin && !v.isAdvertiser) set.add("explorer");
  return set;
}

export interface AnnouncementWindow {
  startsAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
}

export type Phase = "scheduled" | "live" | "over";

export function phaseOf(a: AnnouncementWindow, now: Date): Phase {
  if (a.endedAt) return "over";
  if (a.endsAt && a.endsAt <= now) return "over";
  if (a.startsAt && a.startsAt > now) return "scheduled";
  return "live";
}

export function shownTo(a: { audiences: Audience[] }, viewer: Set<Audience>): boolean {
  return a.audiences.some((x) => viewer.has(x));
}

/** The forbidden public claims (CLAUDE.md §0) found in a message. An
 *  announcement is public copy, so the server refuses these at the source. */
export function forbiddenPhrasesIn(message: string): string[] {
  const lower = message.toLowerCase();
  return FORBIDDEN_PUBLIC_PHRASES.filter((p) => lower.includes(p));
}

// The admin form takes wall-clock times in Mountain time (datetime-local has
// no zone); AvAI and its operator run on Mountain time.
const ZONE = "America/Denver";

function zoneOffsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - at.getTime();
}

/** "2026-10-04T02:00" in Mountain time → the UTC instant. */
export function mountainLocalToDate(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`not a datetime-local value: ${local}`);
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Two passes settle the offset across a DST change.
  let guess = naive - zoneOffsetMs(new Date(naive));
  guess = naive - zoneOffsetMs(new Date(guess));
  return new Date(guess);
}

export function formatMountain(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use the date and time picker.")
  .transform(mountainLocalToDate);
const optionalLocal = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(localDateTime.optional());

export const createAnnouncementSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Write the announcement.")
      .max(300, "Keep it to 300 characters.")
      .refine((m) => forbiddenPhrasesIn(m).length === 0, {
        message: `Remove claims we can't make in public copy: ${FORBIDDEN_PUBLIC_PHRASES.join(", ")}.`,
      }),
    severity: z.enum(["info", "maintenance", "incident"]),
    audiences: z
      .array(z.enum(["everyone", "explorer", "sar", "sar_admin", "advertiser", "staff"]))
      .min(1, "Pick at least one audience."),
    startsAt: optionalLocal,
    endsAt: optionalLocal,
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: "The end must be after the start.",
    path: ["endsAt"],
  });
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
