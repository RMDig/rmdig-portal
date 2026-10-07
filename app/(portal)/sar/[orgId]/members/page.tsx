import { and, asc, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { orgInvitations, orgMemberships, sarOrgs, users } from "@/lib/db/schema";
import { InviteForm } from "./InviteForm";
import { MemberControls, RevokeInvite } from "./MemberControls";

export const metadata = {
  title: "Members — rmdig",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  dispatcher: "Dispatcher",
  responder: "Responder",
};

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }
  // Org-admin only — re-checked here, never trusting the nav (docs/plans/06).
  if (!(await canManageOrg(session.user.id, orgId))) {
    redirect("/dashboard");
  }

  const [org] = await db
    .select({ name: sarOrgs.name, status: sarOrgs.status })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) {
    redirect("/dashboard");
  }

  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: orgMemberships.role,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId))
    .orderBy(asc(orgMemberships.joinedAt));

  const pending = await db
    .select({ id: orgInvitations.id, email: orgInvitations.email, role: orgInvitations.role })
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.orgId, orgId),
        isNull(orgInvitations.acceptedAt),
        gt(orgInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(orgInvitations.createdAt));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="text-muted-foreground mt-1">
          Members and invitations. An organization always keeps at least one admin.{" "}
          <Link href={`/sar/${orgId}/terms`} className="font-medium underline">
            Team terms
          </Link>
          {" · "}
          <Link href={`/sar/${orgId}/alerts`} className="font-medium underline">
            Alerts
          </Link>
        </p>
      </div>

      {org.status === "approved" || org.status === "pending" ? (
        <>
          {org.status === "pending" ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
              Your organization is under review. You can invite teammates and finish setting
              up now.
            </p>
          ) : null}
          <InviteForm orgId={orgId} />
        </>
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Your organization is {org.status}, so inviting members is unavailable.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Members</h2>
        <ul className="divide-y rounded-md border">
          {members.map((m) => {
            const isYou = m.userId === session.user.id;
            const label = m.displayName ?? m.email;
            return (
              <li key={m.userId} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div>
                  <span>{label}</span>
                  {isYou ? <span className="text-muted-foreground text-sm"> (you)</span> : null}
                  {m.displayName ? <p className="text-muted-foreground text-xs">{m.email}</p> : null}
                </div>
                <MemberControls orgId={orgId} userId={m.userId} role={m.role} isYou={isYou} label={label} />
              </li>
            );
          })}
        </ul>
      </section>

      {pending.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-md border">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <span>{p.email}</span>
                  <p className="text-muted-foreground text-xs">Invited as {ROLE_LABEL[p.role] ?? p.role}</p>
                </div>
                <RevokeInvite orgId={orgId} invitationId={p.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
