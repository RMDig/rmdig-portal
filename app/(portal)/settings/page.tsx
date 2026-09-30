import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
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
    redirect("/sign-in");
  }

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
