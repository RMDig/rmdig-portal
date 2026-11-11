import { eq } from "drizzle-orm";

import { SectionTabs } from "@/components/nav/SectionTabs";
import { auth } from "@/lib/auth";
import { getOrgRole } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarOrgs, sarOrgSync } from "@/lib/db/schema";
import { teamTabs } from "@/lib/nav/sections";
import { TEAM_ROLE_PHRASE } from "@/lib/labels";
import { teamHasAdmin } from "@/lib/sar/no-admin";
import { REMEDY_COPY, shouldShow, waitingText } from "@/lib/sar/recovery-rules";
import type { Remedy } from "@/lib/avserv/sar-teams";

// A team's pages under one name and one tab bar (Members · Alerts · Terms ·
// Application), each tab shown only to the roles its page admits. Each page
// still checks access itself; for a non-member this renders the page alone,
// which redirects.
export default async function TeamLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const userId = (await auth())?.user?.id;
  const role = userId && /^[0-9a-f-]{36}$/i.test(orgId) ? await getOrgRole(userId, orgId) : null;
  const [org] = role ? await db.select({ name: sarOrgs.name, status: sarOrgs.status }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1) : [];
  if (!role || !org) return children;
  // An admin viewing means there is one; otherwise check (plan 33 §6.4).
  const noAdmin = role !== "admin" && !(await teamHasAdmin(orgId));
  // A node that can't send the team alerts, as it last said (plan 33 §6.9
  // F4): what fixes it, and what it's holding. Responders see no alerts, so
  // they aren't shown it.
  const unusable =
    role === "responder"
      ? []
      : (await db.select({ node: sarOrgSync.node, remedy: sarOrgSync.remedy, waiting: sarOrgSync.waitingAlerts }).from(sarOrgSync).where(eq(sarOrgSync.orgId, orgId)))
          .map((r) => ({ ...r, remedy: r.remedy as Remedy | null }))
          .filter((r): r is { node: string; remedy: Remedy; waiting: number | null } => r.remedy !== null && shouldShow(org.status, r.remedy));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{org.name}</span> · You&apos;re {TEAM_ROLE_PHRASE[role]}
        </p>
        <SectionTabs label="Team" tabs={teamTabs(orgId, role, org.status)} />
      </div>
      {unusable.length ? (
        <div role="alert" className="space-y-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          {/* [COUNSEL]: team-facing wording (plan 33 §6.9 F3); the remedy words are lib/sar/recovery-rules.ts. */}
          <p className="font-medium">
            AvAI can&apos;t send your team alerts from {unusable.length === 1 ? "one of its servers" : "some of its servers"} until this is fixed:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {unusable.map((u) => (
              <li key={u.node}>
                <span className="font-medium">{u.node}:</span> {REMEDY_COPY[u.remedy].text}
                {u.waiting ? ` ${waitingText(u.waiting)}` : ""}
                {role === "admin" && REMEDY_COPY[u.remedy].page ? (
                  <>
                    {" "}
                    <a href={`/sar/${orgId}/${REMEDY_COPY[u.remedy].page}`} className="font-medium underline">
                      Fix it
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {noAdmin ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          Your team has no admin, so nobody can manage its members, terms or service area. rmdig staff have been told;
          you can also contact rmdig support.
        </p>
      ) : null}
      {children}
    </div>
  );
}
