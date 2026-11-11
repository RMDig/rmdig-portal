import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { formatMountainDate } from "@/lib/format/time";
import { TEAM_STATUS_LABEL } from "@/lib/labels";

import { GiveNoticeForm, UndoNoticeForm } from "./LeaveForms";

export const metadata = { title: "Leaving AvAI — rmdig" };

// [COUNSEL]: team-facing wording (plan 33 §6.9 F3), for counsel's review before
// the first real team. A change here goes to counsel too.
// A team's admins give its leaving notice, or undo it until rmdig staff
// withdraw the team (plan 33 §6.9; lib/sar/leaving.ts). The words say what
// AvServ does (sar_team_sync.md §4): no new offers or check-outs, and the ones
// already bound keep the team until each ends.
export default async function LeavePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(session.user.id, orgId))) redirect("/dashboard");

  const [org] = await db
    .select({ status: sarOrgs.status, leavingNoticeAt: sarOrgs.leavingNoticeAt })
    .from(sarOrgs)
    .where(eq(sarOrgs.id, orgId))
    .limit(1);
  if (!org) redirect("/dashboard");

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Leaving AvAI</h1>
      {org.status === "approved" ? (
        <>
          <div className="text-muted-foreground space-y-2">
            <p>If your team stops taking part, give your leaving notice here. When you do:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>AvAI stops offering your team to users, and no new check-out can name it.</li>
              <li>
                Check-outs that already name your team keep it until each one ends, and your team still gets their
                alerts until then.
              </li>
              <li>Once none are left, rmdig staff withdraw your team.</li>
            </ul>
            <p>You can undo the notice here until your team is withdrawn.</p>
          </div>
          <GiveNoticeForm orgId={orgId} />
        </>
      ) : org.status === "leaving" ? (
        <>
          <div className="text-muted-foreground space-y-2">
            <p>
              Your team gave its leaving notice
              {org.leavingNoticeAt ? ` on ${formatMountainDate(org.leavingNoticeAt)}` : ""}. AvAI no longer offers your
              team, and no new check-out can name it. Check-outs that already name it keep it until each one ends, and
              your team still gets their alerts until then.
            </p>
            <p>Undo the notice to take part again: AvAI offers your team to users as before.</p>
          </div>
          <UndoNoticeForm orgId={orgId} />
        </>
      ) : (
        <p className="text-muted-foreground">
          Your team is {TEAM_STATUS_LABEL[org.status].toLowerCase()}, so there&apos;s no leaving notice to give or undo.
          Contact rmdig support with any questions.
        </p>
      )}
    </div>
  );
}
