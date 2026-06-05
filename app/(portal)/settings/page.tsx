import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DisplayNameCard, PasswordCard } from "./AccountCards";
import { LinkDeviceCard } from "./LinkDeviceCard";

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
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <DisplayNameCard displayName={user?.displayName ?? user?.name ?? ""} />
      <PasswordCard hasPassword={!!user?.passwordHash} />
      <LinkDeviceCard />
    </div>
  );
}
