import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgSync } from "@/lib/db/schema";
import { formatMountain } from "@/lib/format/time";
import { TEAM_STATUS_LABEL } from "@/lib/labels";
import { capacityText, formatCount, MODE_TEXT } from "@/lib/sar/capacity";
import { isPastTeam } from "@/lib/sar/team-status";

import { AcceptanceModeForm, CapacityForm, NearbyListingForm } from "./CheckoutForms";

export const metadata = { title: "Check-outs — rmdig" };

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.
// A team's admins set the most check-outs AvServ binds to the team at once
// (plan 33 D5, 9.7) and who may name it (D4, 9.8; approvals on ../approvals),
// and see each AvAI server's own count (sar_team_sync.md
// §5.4, read by lib/sar/recovery.ts after each sync and every 5 minutes). The
// words say what AvServ does: the limit applies when a check-out would add
// the team, check-outs that already have it keep it, and each server counts
// its own, so two at the same moment can go one over (plan 41 §17.7).
export default async function CheckoutsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(session.user.id, orgId))) redirect("/dashboard");

  const [org] = await db
    .select({ status: sarOrgs.status, cap: sarOrgs.maxActiveCheckouts, mode: sarOrgs.acceptanceMode, nearbyAt: sarOrgs.nearbyListingAt })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) redirect("/dashboard");
  const nodes = await db
    .select({
      node: sarOrgSync.node,
      activeCheckouts: sarOrgSync.activeCheckouts,
      overCapacity: sarOrgSync.overCapacity,
      viewReadAt: sarOrgSync.viewReadAt,
      viewError: sarOrgSync.viewError,
    })
    .from(sarOrgSync)
    .where(eq(sarOrgSync.orgId, orgId))
    .orderBy(asc(sarOrgSync.node));

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Check-outs</h1>
      {isPastTeam(org.status) ? (
        <p className="text-muted-foreground">
          Your team is {TEAM_STATUS_LABEL[org.status].toLowerCase()}, so it has no check-outs or limit to set.
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-medium">Your team&apos;s limit: {capacityText(org.cap).toLowerCase()}</h2>
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>
                You can limit how many check-outs name your team at the same time. While your team is at its limit, no
                new check-out can add it; check-outs that already name it keep it until each one ends.
              </p>
              <p>
                Each AvAI server counts the check-outs it holds, so two people checking out at the same moment on
                different servers can take your team one over the limit.
              </p>
            </div>
            <CapacityForm orgId={orgId} cap={org.cap} />
          </section>

          <section className="space-y-3">
            <h2 className="font-medium">Who can name your team: {MODE_TEXT[org.mode]}</h2>
            <p className="text-muted-foreground text-sm">
              A change applies to new check-outs only: check-outs that already name your team keep it.
            </p>
            <AcceptanceModeForm orgId={orgId} mode={org.mode} />
          </section>

          <section className="space-y-3">
            <h2 className="font-medium">Nearby searches: {org.nearbyAt ? "your team is shown" : "your team isn't shown"}</h2>
            {/* [COUNSEL] held (AvApp plan 68 b): the line saying your service area is shown on the phones of
                people who accept your terms goes here once counsel answers. Don't write it before then. */}
            <p className="text-muted-foreground text-sm">Off unless you turn it on. It only decides whether your team is listed nearby.</p>
            <NearbyListingForm orgId={orgId} on={org.nearbyAt !== null} />
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">Check-outs naming your team now</h2>
            {nodes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {org.status === "pending"
                  ? "None yet: AvAI's servers get your team once it's approved."
                  : "No AvAI server has reported a count yet."}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {nodes.map((n) => (
                  <li key={n.node}>
                    <span className="font-medium">{n.node}</span>:{" "}
                    {n.activeCheckouts === null ? "no count yet" : `${formatCount(n.activeCheckouts)} now`}
                    {n.overCapacity ? <span className="text-amber-800 dark:text-amber-200"> · over your limit</span> : null}
                    {n.viewReadAt ? <span className="text-muted-foreground"> · as of {formatMountain(n.viewReadAt)}</span> : null}
                    {n.viewError ? <span className="text-muted-foreground"> · the last read didn&apos;t answer</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
