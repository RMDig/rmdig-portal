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

export const metadata = {
  title: "Dashboard — rmdig",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  dispatcher: "Dispatcher",
  responder: "Responder",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Under review",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
};
const ADVERTISER_ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  editor: "Editor",
};
const ADVERTISER_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
};

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

  const advertisers = userId
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
          title: "Set up your Search & Rescue organization",
          body: "Register your team — service region, contact info, and proof of operating status. Your application goes to our review queue, and you can invite teammates while it's reviewed.",
          href: "/sar/new",
          cta: "Register your SAR organization",
        }
      : me?.signupIntent === "advertiser" && advertisers.length === 0
        ? {
            title: "Set up your advertiser account",
            body: "Create your advertiser account, then author campaigns and creatives. Every creative is manually reviewed before it appears in the app.",
            href: "/advertiser/new",
            cta: "Create advertiser account",
          }
        : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
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
      <p className="text-muted-foreground">Signed in as {session?.user?.email}.</p>

      {orgs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Your organizations</h2>
          <ul className="divide-y rounded-md border">
            {orgs.map((o) => (
              <li key={o.orgId} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-medium">{o.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {ROLE_LABEL[o.role] ?? o.role} · {STATUS_LABEL[o.status] ?? o.status}
                  </p>
                </div>
                {o.role === "admin" ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/sar/${o.orgId}/members`}>Manage members</Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {advertisers.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Your advertiser accounts</h2>
          <ul className="divide-y rounded-md border">
            {advertisers.map((a) => (
              <li
                key={a.advertiserId}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {ADVERTISER_ROLE_LABEL[a.role] ?? a.role} ·{" "}
                    {ADVERTISER_STATUS_LABEL[a.status] ?? a.status}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/advertiser/${a.advertiserId}/creatives`}>Creatives</Link>
                  </Button>
                  {a.role === "admin" ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/advertiser/${a.advertiserId}/members`}>Manage team</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Search &amp; rescue organizations</CardTitle>
          <CardDescription>
            Run a SAR team? Register your organization and draw your service area. Our staff
            review every application before approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/sar/new">Register a SAR organization</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advertise on AvAI</CardTitle>
          <CardDescription>
            Sponsor ads help fund the platform while keeping the app free. Create an advertiser
            account to author creatives and submit them for review. Every creative is manually
            reviewed before it appears in the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/advertiser/new">Create an advertiser account</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
