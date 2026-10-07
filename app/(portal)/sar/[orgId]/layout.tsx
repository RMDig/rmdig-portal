import { eq } from "drizzle-orm";

import { SectionTabs } from "@/components/nav/SectionTabs";
import { auth } from "@/lib/auth";
import { getOrgRole } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { teamTabs } from "@/lib/nav/sections";

const ROLE_PHRASE = { admin: "an admin", dispatcher: "a dispatcher", responder: "a responder" } as const;

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

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{org.name}</span> · You&apos;re {ROLE_PHRASE[role]}
        </p>
        <SectionTabs label="Team" tabs={teamTabs(orgId, role, org.status)} />
      </div>
      {children}
    </div>
  );
}
