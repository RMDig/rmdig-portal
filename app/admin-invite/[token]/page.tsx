import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { platformRoleInvitations } from "@/lib/db/schema";
import { hashInviteToken } from "@/lib/sar/invitations";
import { AcceptInvite } from "./AcceptInvite";

export const metadata = {
  title: "Staff invitation — rmdig",
};

export default async function AdminInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  const tokenHash = hashInviteToken(token);
  const [invite] = await db
    .select({
      email: platformRoleInvitations.email,
      role: platformRoleInvitations.role,
    })
    .from(platformRoleInvitations)
    .where(
      and(
        eq(platformRoleInvitations.tokenHash, tokenHash),
        isNull(platformRoleInvitations.acceptedAt),
        gt(platformRoleInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-16">
      {!invite ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
          <p className="text-muted-foreground">
            This invitation is invalid, already used, or has expired. Ask a platform
            administrator to send a new one.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      ) : !session?.user ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Join the rmdig team</h1>
          <p className="text-muted-foreground">
            You&apos;ve been invited to join the rmdig platform team as{" "}
            <strong>{PLATFORM_ROLE_LABEL[invite.role]}</strong>. Sign in or create an
            account with <strong>{invite.email}</strong>, then open this link again to
            accept.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-up">Create account</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Join the rmdig team</h1>
          <p className="text-muted-foreground">
            You&apos;ve been invited to become <strong>{PLATFORM_ROLE_LABEL[invite.role]}</strong>{" "}
            on the rmdig platform. This invitation was issued to{" "}
            <strong>{invite.email}</strong> and staff accounts require two-factor
            authentication.
          </p>
          <AcceptInvite token={token} />
        </div>
      )}
    </div>
  );
}
