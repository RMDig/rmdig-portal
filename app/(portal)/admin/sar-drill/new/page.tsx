import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPlatformRole } from "@/lib/auth/roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { phoneVerificationEnabled } from "@/lib/phone/verify";
import { circleRing, DRILL_AREA_DEFAULT } from "@/lib/sar/drill";

import { DrillOrgForm } from "./DrillOrgForm";

export const metadata = {
  title: "Register a drill team — rmdig admin",
};

export default async function NewDrillTeamPage() {
  // rmdig_admin only; registerDrillOrgAction re-checks (a page never gates a write).
  const session = await auth();
  if (!session?.user) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");

  const defaultArea = { type: "Polygon" as const, coordinates: [circleRing(DRILL_AREA_DEFAULT, DRILL_AREA_DEFAULT.radiusM)] };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register a drill team</h1>
        <p className="text-muted-foreground mt-1">
          A drill team is RMDig&apos;s own test team. AvServ never offers it to a real user, and its alerts
          are marked DRILL. It isn&apos;t reviewed: once it has drill logins and published terms, you
          activate it from Drill teams.
        </p>
      </div>
      <DrillOrgForm phoneVerifyEnabled={phoneVerificationEnabled()} defaultArea={defaultArea} />
    </div>
  );
}
