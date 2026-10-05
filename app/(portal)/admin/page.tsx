import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Admin — rmdig",
};

export default async function AdminPage() {
  // The portal layout gates auth; this gates the platform-role requirement.
  // Defense-in-depth: the nav hides the link for non-staff, but the route
  // enforces it too so a direct URL can't reach admin tools.
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }
  const roles = await getPlatformRoles(session.user.id);
  if (roles.length === 0) {
    redirect("/dashboard");
  }
  const isAdmin = roles.includes("rmdig_admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Your platform roles: {roles.map((r) => PLATFORM_ROLE_LABEL[r] ?? r).join(", ")}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SAR approvals</CardTitle>
          <CardDescription>
            Review pending search-and-rescue organization applications and approve, reject, or
            request changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/admin/sar-approvals">Open the approvals queue</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ad approvals</CardTitle>
          <CardDescription>
            Review submitted ad creatives and approve, reject, or request changes. No creative
            reaches the app until you approve it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/admin/ad-approvals">Open the ad-approvals queue</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restriction reviews</CardTitle>
          <CardDescription>
            Users asking us to review a restriction on their AvAI account. Lift or uphold, with
            a note for the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/admin/restriction-reviews">Open the review queue</Link>
          </Button>
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Team terms review</CardTitle>
            <CardDescription>
              Search &amp; rescue teams&apos; terms and the services they provide. Publish or send back each
              submitted version.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          <CardContent>
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
            <CardTitle>Team</CardTitle>
            <CardDescription>
              Invite new administrators or reviewers and manage who holds staff roles.
              Grants and revocations require your password and are audit-logged.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/team">Manage team</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
