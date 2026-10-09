import { eq } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { hasAdminWork } from "@/lib/auth/admin-work";
import { getPlatformRoles, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { featureEnabled } from "@/lib/features";
import { DisplayNameCard, PasswordCard } from "./AccountCards";
import { AvaiAccountCard } from "./AvaiAccountCard";
import { MfaCard } from "./MfaCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Settings — rmdig",
};

export default async function SettingsPage() {
  // The portal layout gates auth; re-read for the typed id and account fields.
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }

  const roles = await getPlatformRoles(session.user.id);
  const adminWork = hasAdminWork(roles, {
    adsOn: featureEnabled("advertiser_portal"),
    reviewsOn: featureEnabled("restriction_review"),
  });

  const [user] = await db
    .select({
      displayName: users.displayName,
      name: users.name,
      passwordHash: users.passwordHash,
      mfaEnabledAt: users.mfaEnabledAt,
      avservAccountId: users.avservAccountId,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <DisplayNameCard displayName={user?.displayName ?? user?.name ?? ""} />
      <AvaiAccountCard
        userId={session.user.id}
        avservAccountId={user?.avservAccountId ?? null}
        portalName={user?.displayName ?? user?.name ?? ""}
      />
      <PasswordCard hasPassword={!!user?.passwordHash} />
      <MfaCard enabled={!!user?.mfaEnabledAt} />
      {roles.length > 0 ? (
        // Staff roles live here rather than on an Admin page that may have
        // nothing for them (lib/auth/admin-work.ts).
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Platform roles</CardTitle>
              <CardDescription>
                {roles.map((r) => PLATFORM_ROLE_LABEL[r]).join(", ")}.
                {adminWork ? null : " Nothing on the Admin page applies to these roles right now."}
              </CardDescription>
            </div>
            {adminWork ? (
              <Button asChild variant="outline">
                <Link href="/admin">Open admin</Link>
              </Button>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              View the devices linked to your account and generate a code to link a new one.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings/devices">Manage devices</Link>
          </Button>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Delete account &amp; data</CardTitle>
            <CardDescription>
              Request deletion of your account and the personal data we hold, under the
              Colorado Privacy Act. Confirmed by email; completed within 45 days.
            </CardDescription>
          </div>
          <Button asChild variant="outline">
            <Link href="/account/delete">Request deletion</Link>
          </Button>
        </CardHeader>
      </Card>
    </div>
  );
}
