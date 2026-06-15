import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { orgInvitations, orgMemberships, sarOrgs, users } from "@/lib/db/schema";
import { InviteForm } from "./InviteForm";

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
    redirect("/sign-in");
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
    .select({ email: users.email, displayName: users.displayName, role: orgMemberships.role })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId))
    .orderBy(asc(orgMemberships.joinedAt));

  const pending = await db
    .select({ email: orgInvitations.email, role: orgInvitations.role })
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
        <p className="text-muted-foreground mt-1">Members and invitations.</p>
      </div>

      {org.status === "approved" ? (
        <InviteForm orgId={orgId} />
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Your organization is {org.status}. You can invite members once it&apos;s approved.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Members</h2>
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between px-4 py-3">
              <span>{m.displayName ?? m.email}</span>
              <span className="text-muted-foreground text-sm">
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {pending.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-md border">
            {pending.map((p) => (
              <li key={p.email} className="flex items-center justify-between px-4 py-3">
                <span>{p.email}</span>
                <span className="text-muted-foreground text-sm">
                  Invited as {ROLE_LABEL[p.role] ?? p.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
