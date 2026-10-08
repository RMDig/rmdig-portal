import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import {
  advertiserAccounts,
  advertiserMemberships,
  orgMemberships,
  sarOrgs,
  users,
} from "@/lib/db/schema";
import { featureEnabled } from "@/lib/features";
import { ADVERTISER_ROLE_LABEL, ADVERTISER_STATUS_LABEL, TEAM_ROLE_LABEL, TEAM_STATUS_LABEL } from "@/lib/labels";

export const metadata = {
  title: "Dashboard — rmdig",
};

// What most people come to the portal for: the app account they use AvAI with.
const ACCOUNT_LINKS = [
  { href: "/settings/agreement", title: "AvAI user agreement", body: "The agreement for using the AvAI app, and whether you've accepted it." },
  { href: "/settings/devices", title: "Devices", body: "Link a phone to your account, and see the phones already linked." },
  { href: "/settings", title: "Settings", body: "Your name, password, two-factor authentication and data." },
] as const;

export default async function DashboardPage() {
  // Layout already redirects unauthenticated users; this is a typed re-read.
  const session = await auth();
  const userId = session?.user?.id;

  const orgs = userId
    ? await db
        .select({
          orgId: orgMemberships.orgId,
          name: sarOrgs.name,
          status: sarOrgs.status,
          role: orgMemberships.role,
        })
        .from(orgMemberships)
        .innerJoin(sarOrgs, eq(sarOrgs.id, orgMemberships.orgId))
        .where(eq(orgMemberships.userId, userId))
        .orderBy(asc(sarOrgs.name))
    : [];

  // The advertiser portal is off until AvServ ships its endpoints
  // (lib/features.ts): no list, no nudge, no "create" card while it is.
  const advertiserPortal = featureEnabled("advertiser_portal");
  const advertisers = userId && advertiserPortal
    ? await db
        .select({
          advertiserId: advertiserMemberships.advertiserId,
          name: advertiserAccounts.name,
          status: advertiserAccounts.status,
          role: advertiserMemberships.role,
        })
        .from(advertiserMemberships)
        .innerJoin(advertiserAccounts, eq(advertiserAccounts.id, advertiserMemberships.advertiserId))
        .where(eq(advertiserMemberships.userId, userId))
        .orderBy(asc(advertiserAccounts.name))
    : [];

  // Sign-up intent routing: nudge SAR/advertiser signers toward their
  // onboarding form until the matching entity exists. Pure UX — grants nothing.
  const [me] = userId
    ? await db
        .select({ signupIntent: users.signupIntent })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    : [];
  const nudge =
    me?.signupIntent === "sar" && orgs.length === 0
      ? {
          title: "Set up your search & rescue team",
          body: "Register your team — service region, contact info, and proof of operating status. Your application goes to our review queue, and you can invite teammates while it's reviewed.",
          href: "/sar/new",
          cta: "Register your team",
        }
      : advertiserPortal && me?.signupIntent === "advertiser" && advertisers.length === 0
        ? {
            title: "Set up your advertiser account",
            body: "Create your advertiser account, then write your ads. Every ad is manually reviewed before it appears in the app.",
            href: "/advertiser/new",
            cta: "Create advertiser account",
          }
        : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Signed in as {session?.user?.email}.</p>
      </div>
      {nudge ? (
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-900/10">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>{nudge.title}</CardTitle>
              <CardDescription>{nudge.body}</CardDescription>
            </div>
            <Button asChild>
              <Link href={nudge.href}>{nudge.cta}</Link>
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      {orgs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Your search &amp; rescue teams</h2>
          <ul className="divide-y rounded-md border">
            {orgs.map((o) => {
              // Each role's way in: admins run the team, dispatchers see alerts.
              const open =
                o.role === "admin"
                  ? { href: `/sar/${o.orgId}/members`, label: "Open team" }
                  : o.role === "dispatcher"
                    ? { href: `/sar/${o.orgId}/alerts`, label: "Alerts" }
                    : null;
              return (
                <li key={o.orgId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-medium">{o.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {TEAM_ROLE_LABEL[o.role]} · {TEAM_STATUS_LABEL[o.status]}
                      {o.role === "responder" ? " · Your team's admins and dispatchers see its alerts" : null}
                    </p>
                  </div>
                  {open ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={open.href}>{open.label}</Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {advertisers.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Your advertiser accounts</h2>
          <ul className="divide-y rounded-md border">
            {advertisers.map((a) => (
              <li key={a.advertiserId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {ADVERTISER_ROLE_LABEL[a.role]} · {ADVERTISER_STATUS_LABEL[a.status]}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/advertiser/${a.advertiserId}/creatives`}>Open account</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your AvAI account</h2>
        <ul className="divide-y rounded-md border">
          {ACCOUNT_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="hover:bg-muted/50 flex items-center justify-between gap-4 px-4 py-3">
                <span>
                  <span className="block font-medium">{l.title}</span>
                  <span className="text-muted-foreground block text-sm">{l.body}</span>
                </span>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">More on rmdig</h2>
        <div className={advertiserPortal ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
          <Card>
            <CardHeader>
              <CardTitle>Search &amp; rescue teams</CardTitle>
              <CardDescription>
                Run a search &amp; rescue team? Register it and draw your service area. Our staff
                review every application before approval.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/sar/new">Register a team</Link>
              </Button>
            </CardContent>
          </Card>
          {advertiserPortal ? (
            <Card>
              <CardHeader>
                <CardTitle>Advertise on AvAI</CardTitle>
                <CardDescription>
                  Sponsor ads help fund the platform while keeping the app free. Create an advertiser
                  account to write ads and submit them for review. Every ad is manually reviewed
                  before it appears in the app.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href="/advertiser/new">Create an advertiser account</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </div>
  );
}
