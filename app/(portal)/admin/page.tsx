import { count, eq, min } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { AD_REVIEW_ROLES, getPlatformRoles, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { adCreatives, deletionRequests, restrictionReviewRequests, sarOrgs, sarOrgTerms } from "@/lib/db/schema";
import { cpaDaysLeft } from "@/lib/deletion/share-log";
import { featureEnabled } from "@/lib/features";

// How much is waiting in each queue, so the hub says where to look first.
function Waiting({ n, detail }: { n: number; detail?: string }) {
  if (n === 0) return <p className="text-muted-foreground text-sm">Nothing waiting.</p>;
  return (
    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
      {n} waiting{detail ? ` · ${detail}` : ""}
    </p>
  );
}

const total = (rows: Array<{ n: number }>) => rows[0]?.n ?? 0;

export const metadata = {
  title: "Admin — rmdig",
};

export default async function AdminPage() {
  // The portal layout gates auth; this gates the platform-role requirement.
  // Defense-in-depth: the nav hides the link for non-staff, but the route
  // enforces it too so a direct URL can't reach admin tools.
  const session = await auth();
  if (!session?.user) {
    return redirectToSignIn();
  }
  const roles = await getPlatformRoles(session.user.id);
  if (roles.length === 0) {
    redirect("/dashboard");
  }
  const isAdmin = roles.includes("rmdig_admin");
  const isSarApprover = roles.includes("rmdig_sar_approver");
  const canReviewAds = roles.some((r) => AD_REVIEW_ROLES.includes(r));
  // Queues for surfaces switched off until AvServ ships them (lib/features.ts).
  const adsOn = featureEnabled("advertiser_portal");
  const reviewsOn = featureEnabled("restriction_review");

  const [sarPending, adsPending, reviewsOpen, termsSubmitted, [deletions]] = await Promise.all([
    isSarApprover ? db.select({ n: count() }).from(sarOrgs).where(eq(sarOrgs.status, "pending")) : Promise.resolve([]),
    adsOn && canReviewAds ? db.select({ n: count() }).from(adCreatives).where(eq(adCreatives.status, "pending")) : Promise.resolve([]),
    reviewsOn
      ? db.select({ n: count() }).from(restrictionReviewRequests).where(eq(restrictionReviewRequests.status, "open"))
      : Promise.resolve([]),
    isAdmin ? db.select({ n: count() }).from(sarOrgTerms).where(eq(sarOrgTerms.status, "submitted")) : Promise.resolve([]),
    isAdmin
      ? db
          .select({ n: count(), oldest: min(deletionRequests.confirmedAt) })
          .from(deletionRequests)
          .where(eq(deletionRequests.status, "confirmed"))
      : Promise.resolve([undefined]),
  ]);
  // The Colorado Privacy Act clock runs from confirmation: show the nearest deadline.
  const left = deletions?.oldest ? cpaDaysLeft(new Date(deletions.oldest), new Date()) : null;
  const deletionDetail = left === null ? undefined : left >= 0 ? `next due in ${left} days` : `oldest ${-left} days overdue`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Your platform roles: {roles.map((r) => PLATFORM_ROLE_LABEL[r] ?? r).join(", ")}.
        </p>
      </div>

      {isSarApprover ? (
        <Card>
          <CardHeader>
            <CardTitle>SAR approvals</CardTitle>
            <CardDescription>
              Review pending search &amp; rescue team applications and approve, reject, or
              request changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Waiting n={total(sarPending)} />
            <Button asChild>
              <Link href="/admin/sar-approvals">Open the approvals queue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {adsOn && canReviewAds ? (
        <Card>
          <CardHeader>
            <CardTitle>Ad approvals</CardTitle>
            <CardDescription>
              Review submitted ads and approve, reject, or request changes. No ad
              reaches the app until you approve it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Waiting n={total(adsPending)} />
            <Button asChild>
              <Link href="/admin/ad-approvals">Open the ad-approvals queue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {reviewsOn ? (
        <Card>
          <CardHeader>
            <CardTitle>Restriction reviews</CardTitle>
            <CardDescription>
              Users asking us to review a restriction on their AvAI account. Lift or uphold, with
              a note for the audit log.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Waiting n={total(reviewsOpen)} />
            <Button asChild>
              <Link href="/admin/restriction-reviews">Open the review queue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Team terms review</CardTitle>
            <CardDescription>
              Search &amp; rescue teams&apos; terms and the services they provide. Publish or send back each
              submitted version.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Waiting n={total(termsSubmitted)} />
            <Button asChild>
              <Link href="/admin/sar-terms">Review team terms</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
            <CardDescription>
              Post a banner on signed-in portal pages, scheduled and targeted by audience, and
              preview what each audience sees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/announcements">Manage announcements</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Deletion requests</CardTitle>
            <CardDescription>
              Confirmed data-deletion requests with their 45-day deadlines, and which search &amp;
              rescue teams received each account&apos;s data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Waiting n={deletions?.n ?? 0} detail={deletionDetail} />
            <Button asChild>
              <Link href="/admin/deletion-requests">Open the deletion queue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>AvServ checks</CardTitle>
            <CardDescription>
              Confirm each AvAI server has the routes the portal uses and our key holds each route
              group. Run after a server release or key change.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/avserv-checks">Run AvServ checks</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Staff</CardTitle>
            <CardDescription>
              Invite new administrators or reviewers and manage who holds staff roles.
              Grants and revocations require your password and are audit-logged.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/team">Manage staff</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
