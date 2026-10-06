import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  adCampaigns,
  adCreatives,
  advertiserAccounts,
  advertiserMemberships,
  deletionRequests,
  orgMemberships,
  sarAlertAcks,
  sarIntakeMessages,
  sarOrgs,
  sarOrgTerms,
  type SarCapabilitySetting,
} from "./db/schema";
import type { IntakePayload } from "./sar/intake";
import { termsSha256 } from "./sar/terms";

// The PREVIEW demo world (scripts/seed-preview.ts): sample SAR teams, alerts,
// an advertiser and a deletion request, so every portal surface has something
// to show on a preview, for showcasing and everyday testing. Preview database
// and mock AvServ only: nothing here may ever be written to production, where
// a sample team could be offered to real users as a team that will be alerted
// (CLAUDE.md §0). Fixed ids keep re-runs idempotent and let the mock AvServ
// feed (lib/avserv/sar-feeds-mock.ts) answer from these alerts.

export const DEMO = {
  team: "d0000000-0000-4000-8000-0000000000a1",
  patrol: "d0000000-0000-4000-8000-0000000000a2",
  advertiser: "d0000000-0000-4000-8000-0000000000b1",
  campaign: "d0000000-0000-4000-8000-0000000000b2",
} as const;

const TEAM_AREA = {
  type: "Polygon" as const,
  coordinates: [[[-106.16, 39.4], [-105.9, 39.4], [-105.9, 39.62], [-106.16, 39.62], [-106.16, 39.4]]],
};
const PATROL_AREA = {
  type: "Polygon" as const,
  coordinates: [[[-106.2, 39.47], [-106.12, 39.47], [-106.12, 39.53], [-106.2, 39.53], [-106.2, 39.47]]],
};

const CAPABILITIES: SarCapabilitySetting[] = [
  { name: "checkout_alerts", channels: ["portal", "email"] },
  { name: "send_help_added", channels: ["portal", "email"] },
];

export const DEMO_TERMS = `This is a sample team on an AvAI preview. It is not a real search and rescue team, and nothing sent to it reaches anyone.

What this sample team does through AvAI:
- Receives missed check-in alerts from users who added it to a check-out.
- Receives Send Help requests from users who added it.

What it does not do:
- It does not call 911 for you. If someone may be in danger, call 911.
- Adding it does not replace your personal emergency contact.`;

const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

/** The demo team's alert deliveries, timed relative to `now`: an open missed
 *  check-in delivered by both nodes, a Send Help resolved two days ago (its
 *  position already removed, as retention does after 24 hours), and an "Also
 *  send help" from a user in the area that was retracted. */
export function demoIntakeMessages(now: Date): Array<{ messageId: string; payload: IntakePayload; receivedAt: Date }> {
  const team = DEMO.team;
  const env = (messageId: string, alertId: string, node: string, minutesAgo: number, capability: "checkout_alerts" | "send_help_added" | "send_help_area" | null) => ({
    schemaVersion: 1 as const,
    messageId,
    alertId,
    teamId: team,
    capability,
    node,
    sentAt: ago(now, minutesAgo),
    drill: false,
  });
  const open = `demo-checkout-1:${team}`;
  const resolved = `demo-help-1:${team}`;
  const retracted = `demo-help-2:${team}`;
  const fix = (lat: number, lon: number, acc: number, minutesAgo: number) => ({ lat, lon, accuracyMeters: acc, at: ago(now, minutesAgo) });
  const overdue = (node: string, id: string): IntakePayload => ({
    ...env(id, open, node, 40, "checkout_alerts"),
    kind: "overdue",
    alert: {
      checkoutId: "demo-checkout-1",
      userDisplayName: "Sam Sample",
      lastFix: fix(39.485, -106.045, 25, 95),
      plannedRoute: { type: "MultiLineString", coordinates: [[[-106.06, 39.47], [-106.045, 39.485], [-106.02, 39.5]]] },
      expectedReturnAt: ago(now, 60),
      alertedAt: ago(now, 40),
    },
  });
  const messages: Array<{ payload: IntakePayload; minutesAgo: number }> = [
    { payload: overdue("avserv-2", "demo-msg-1a"), minutesAgo: 40 },
    { payload: overdue("avserv-3", "demo-msg-1b"), minutesAgo: 40 },
    {
      payload: {
        ...env("demo-msg-2", resolved, "avserv-2", 2 * 1440, "send_help_added"),
        kind: "send_help",
        alert: { helpRequestId: "demo-help-1", userDisplayName: "Alex Example", lastFix: null, note: null, checkoutId: null, openedAt: ago(now, 2 * 1440) },
      },
      minutesAgo: 2 * 1440,
    },
    {
      payload: { ...env("demo-msg-3", resolved, "avserv-2", 2 * 1440 - 60, null), kind: "all_clear", alert: { refersTo: resolved, at: ago(now, 2 * 1440 - 60) } },
      minutesAgo: 2 * 1440 - 60,
    },
    {
      payload: {
        ...env("demo-msg-4", retracted, "avserv-3", 180, "send_help_area"),
        kind: "send_help",
        alert: {
          helpRequestId: "demo-help-2",
          userDisplayName: "Jo Placeholder",
          lastFix: fix(39.52, -105.98, 60, 182),
          note: "Twisted my knee, walking out slowly.",
          checkoutId: null,
          openedAt: ago(now, 180),
        },
      },
      minutesAgo: 180,
    },
    {
      payload: { ...env("demo-msg-5", retracted, "avserv-3", 160, null), kind: "disregard", alert: { refersTo: retracted, at: ago(now, 160) } },
      minutesAgo: 160,
    },
  ];
  return messages.map((m) => ({ messageId: m.payload.messageId, payload: m.payload, receivedAt: new Date(ago(now, m.minutesAgo)) }));
}

type Db = PostgresJsDatabase;

async function setArea(db: Db, orgId: string, area: typeof TEAM_AREA): Promise<void> {
  // Same guarded write as lib/sar/geo setRegionGeom, which can't be imported
  // here: it loads the app's env, and this runs from a seed script.
  const json = JSON.stringify(area);
  await db.execute(sql`
    UPDATE sar_orgs SET region_geom = ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326)::geography
    WHERE id = ${orgId} AND ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}), 4326))`);
}

/** Seed (or top up) the demo world. Idempotent: existing rows are left alone. */
export async function seedDemoWorld(
  db: Db,
  people: { admin: string; sar: string; advertiser: string; sarEmail: string; advertiserEmail: string },
  now = new Date(),
): Promise<void> {
  const orgs = [
    { id: DEMO.team, name: "Demo Search & Rescue (sample, not a real team)", regionName: "Summit County, CO (sample)", orgType: "sar_team" as const, area: TEAM_AREA, patrol: false },
    { id: DEMO.patrol, name: "Demo Ski Patrol (sample, not a real patrol)", regionName: "Copper area, CO (sample)", orgType: "ski_patrol" as const, area: PATROL_AREA, patrol: true },
  ];
  for (const o of orgs) {
    await db
      .insert(sarOrgs)
      .values({
        id: o.id,
        name: o.name,
        orgType: o.orgType,
        regionName: o.regionName,
        contactName: "Preview SAR Lead",
        contactEmail: people.sarEmail,
        operatingStatus: "volunteer_group",
        proofDocUrl: "https://example.invalid/preview-demo-proof.pdf",
        status: "approved",
        approvedAt: now,
        approvedByUserId: people.admin,
        createdByUserId: people.sar,
        // The patrol is due for re-verification in 20 days, so the reminder
        // emails and the approvals page have something to show.
        verifiedAt: o.patrol ? new Date(now.getTime() - 345 * 86_400_000) : null,
        reverifyBy: o.patrol ? new Date(now.getTime() + 20 * 86_400_000) : null,
      })
      .onConflictDoNothing();
    await setArea(db, o.id, o.area);
    await db.insert(orgMemberships).values({ orgId: o.id, userId: people.sar, role: "admin" }).onConflictDoNothing();
    const [hasTerms] = await db.execute(sql`SELECT 1 FROM sar_org_terms WHERE org_id = ${o.id} AND status = 'published' LIMIT 1`);
    if (!hasTerms) {
      await db.insert(sarOrgTerms).values({
        orgId: o.id,
        version: 1,
        body: DEMO_TERMS,
        capabilities: CAPABILITIES,
        sha256: termsSha256(DEMO_TERMS),
        status: "published",
        authorUserId: people.sar,
        submittedAt: now,
        reviewedByUserId: people.admin,
        reviewedAt: now,
        publishedAt: now,
        requiresReacceptance: true,
      });
    }
  }

  for (const m of demoIntakeMessages(now)) {
    await db
      .insert(sarIntakeMessages)
      .values({
        messageId: m.messageId,
        alertId: m.payload.alertId,
        orgId: DEMO.team,
        kind: m.payload.kind,
        capability: m.payload.capability ?? null,
        node: m.payload.node,
        drill: false,
        sentAt: new Date(m.payload.sentAt),
        receivedAt: m.receivedAt,
        payload: m.payload,
      })
      .onConflictDoNothing();
  }
  // The retracted area alert was marked received; the open one is left for
  // the viewer to mark.
  await db
    .insert(sarAlertAcks)
    .values({ orgId: DEMO.team, alertId: `demo-help-2:${DEMO.team}`, ackedByUserId: people.sar, ackedAt: new Date(now.getTime() - 170 * 60_000) })
    .onConflictDoNothing();

  await db
    .insert(advertiserAccounts)
    .values({ id: DEMO.advertiser, name: "Demo Outfitters (sample advertiser)", contactName: "Preview Advertiser", contactEmail: people.advertiserEmail, createdByUserId: people.advertiser })
    .onConflictDoNothing();
  await db.insert(advertiserMemberships).values({ advertiserId: DEMO.advertiser, userId: people.advertiser, role: "admin" }).onConflictDoNothing();
  await db.insert(adCampaigns).values({ id: DEMO.campaign, advertiserId: DEMO.advertiser, name: "Winter sample campaign" }).onConflictDoNothing();
  const creatives = [
    { id: "d0000000-0000-4000-8000-0000000000c1", headline: "Sample: avalanche course this weekend", status: "approved" as const, radius: true, note: null },
    { id: "d0000000-0000-4000-8000-0000000000c2", headline: "Sample: new beacons in stock", status: "pending" as const, radius: false, note: null },
    { id: "d0000000-0000-4000-8000-0000000000c3", headline: "Sample: never worry about avalanches again", status: "rejected" as const, radius: false, note: "Makes a safety claim. Please describe the product instead." },
  ];
  for (const c of creatives) {
    await db
      .insert(adCreatives)
      .values({
        id: c.id,
        campaignId: DEMO.campaign,
        slot: "post_checkin",
        headline: c.headline,
        body: "A sample ad on an AvAI preview.",
        altText: c.headline,
        targetKind: c.radius ? "radius" : "national",
        targetLat: c.radius ? "39.4817" : null,
        targetLon: c.radius ? "-106.0384" : null,
        targetRadiusMi: c.radius ? 25 : null,
        status: c.status,
        reviewNote: c.note,
        submittedAt: now,
        approvedAt: c.status === "approved" ? now : null,
        approvedByUserId: c.status === "approved" ? people.admin : null,
      })
      .onConflictDoNothing();
  }

  // A confirmed deletion request 30 days into its 45-day clock.
  await db
    .insert(deletionRequests)
    .values({
      email: "former-user@example.com",
      tokenHash: "preview-demo-deletion-request",
      tokenExpiresAt: now,
      status: "confirmed",
      requestedAt: new Date(now.getTime() - 30 * 86_400_000),
      confirmedAt: new Date(now.getTime() - 30 * 86_400_000),
    })
    .onConflictDoNothing();
}
