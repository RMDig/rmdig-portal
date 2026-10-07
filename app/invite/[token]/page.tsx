import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { nextQuery } from "@/lib/auth/return-to";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { orgInvitations, sarOrgs } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { AcceptInvite } from "./AcceptInvite";
import { TEAM_ROLE_PHRASE } from "@/lib/labels";

export const metadata = {
  title: "Accept invitation — rmdig",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await auth();

  const tokenHash = hashInviteToken(token);
  const [invite] = await db
    .select({
      orgId: orgInvitations.orgId,
      orgName: sarOrgs.name,
      role: orgInvitations.role,
    })
    .from(orgInvitations)
    .innerJoin(sarOrgs, eq(sarOrgs.id, orgInvitations.orgId))
    .where(
      and(
        eq(orgInvitations.tokenHash, tokenHash),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-16">
      {!invite ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
          <p className="text-muted-foreground">
            This invitation is invalid, already used, or has expired. Ask the team&apos;s
            admin to send a new one.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      ) : !session?.user ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Join {invite.orgName}</h1>
          <p className="text-muted-foreground">
            You&apos;ve been invited to join <strong>{invite.orgName}</strong> as{" "}
            {TEAM_ROLE_PHRASE[invite.role]}. Sign in or create an account to accept. You&apos;ll come back here afterwards.
          </p>
          <div className="flex gap-3">
            <Button asChild>
              <Link href={`/sign-in${nextQuery(`/invite/${token}`)}`}>Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/sign-up${nextQuery(`/invite/${token}`)}`}>Create account</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Join {invite.orgName}</h1>
          <p className="text-muted-foreground">
            You&apos;re signed in as {session.user.email}. Accept to join{" "}
            <strong>{invite.orgName}</strong> as {TEAM_ROLE_PHRASE[invite.role]}.
          </p>
          <AcceptInvite token={token} />
        </div>
      )}
    </div>
  );
}
