import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { canManageAdvertiser } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import {
  advertiserAccounts,
  advertiserInvitations,
  advertiserMemberships,
  users,
} from "@/lib/db/schema";
import { InviteForm } from "./InviteForm";
import { ADVERTISER_ROLE_LABEL } from "@/lib/labels";

export const metadata = {
  title: "Advertiser team — rmdig",
};

export default async function AdvertiserMembersPage({
  params,
}: {
  params: Promise<{ advertiserId: string }>;
}) {
  const { advertiserId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }
  // Advertiser-admin only — re-checked here, never trusting the nav.
  if (!(await canManageAdvertiser(session.user.id, advertiserId))) {
    redirect("/dashboard");
  }

  const [advertiser] = await db
    .select({ name: advertiserAccounts.name, status: advertiserAccounts.status })
    .from(advertiserAccounts)
    .where(eq(advertiserAccounts.id, advertiserId))
    .limit(1);
  if (!advertiser) {
    redirect("/dashboard");
  }

  const members = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      role: advertiserMemberships.role,
    })
    .from(advertiserMemberships)
    .innerJoin(users, eq(users.id, advertiserMemberships.userId))
    .where(eq(advertiserMemberships.advertiserId, advertiserId))
    .orderBy(asc(advertiserMemberships.joinedAt));

  const pending = await db
    .select({ email: advertiserInvitations.email, role: advertiserInvitations.role })
    .from(advertiserInvitations)
    .where(
      and(
        eq(advertiserInvitations.advertiserId, advertiserId),
        isNull(advertiserInvitations.acceptedAt),
        gt(advertiserInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(advertiserInvitations.createdAt));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground mt-1">Who can work on this account, and open invitations.</p>
      </div>

      {advertiser.status === "active" ? (
        <InviteForm advertiserId={advertiserId} />
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          This advertiser account is suspended. You can invite teammates once it&apos;s reactivated.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Team</h2>
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.email} className="flex items-center justify-between px-4 py-3">
              <span>{m.displayName ?? m.email}</span>
              <span className="text-muted-foreground text-sm">{ADVERTISER_ROLE_LABEL[m.role]}</span>
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
                  Invited as {ADVERTISER_ROLE_LABEL[p.role]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
