import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isAdvertiserMember } from "@/lib/auth/advertiser-roles";
import { db } from "@/lib/db";
import { advertiserAccounts } from "@/lib/db/schema";
import { listStates } from "@/lib/geo/lookup";
import { CreativeForm } from "./CreativeForm";

export const metadata = {
  title: "New creative — rmdig",
};

export default async function NewCreativePage({
  params,
}: {
  params: Promise<{ advertiserId: string }>;
}) {
  const { advertiserId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  // Any team member may author — re-checked here, never trusting the nav.
  if (!(await isAdvertiserMember(session.user.id, advertiserId))) {
    redirect("/dashboard");
  }

  const [advertiser] = await db
    .select({ name: advertiserAccounts.name })
    .from(advertiserAccounts)
    .where(eq(advertiserAccounts.id, advertiserId))
    .limit(1);
  if (!advertiser) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New creative</h1>
        <p className="text-muted-foreground mt-1">
          {advertiser.name} · text ad. Save a draft, preview it, then submit it for review. It only
          appears in the app after the operator approves it.
        </p>
      </div>
      <CreativeForm advertiserId={advertiserId} states={listStates()} />
    </div>
  );
}
