import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { SiteFooter } from "@/components/nav/SiteFooter";
import { SiteHeader } from "@/components/nav/SiteHeader";
import { announcementsFor, type LiveAnnouncement } from "@/lib/announcements/queries";
import { auth } from "@/lib/auth";
import { userMfaGate } from "@/lib/auth/mfa-gate";
import { nextQuery } from "@/lib/auth/return-to";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { navViewer } from "@/lib/nav/viewer";
import { SignOutButton } from "./SignOutButton";

const ENROLL_PATH = "/settings/mfa/enroll";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    // Back to the page they asked for after signing in (an invite, an AvServ
    // notice's account-review link), not always the dashboard.
    return redirectToSignIn();
  }
  const userId = session.user.id;

  // One roles read serves both the Admin nav and the MFA policy (admin_only).
  const { gate, roles } = await userMfaGate(userId);
  const isStaff = roles.length > 0;

  // Authoritative enforcement (see middleware.ts for why this lives here, not in
  // Edge middleware). The pathname comes from middleware so we don't loop the
  // user on the enrollment page itself.
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  if (gate === "required" && pathname !== ENROLL_PATH) {
    // Back to where they were going once two-factor is on (a new team's
    // admin lands here straight after applying).
    redirect(`${ENROLL_PATH}${nextQuery(h.get("x-return-to"))}`);
  }
  const viewer = await navViewer(userId, session.user.email ?? "", roles);

  // Under-review banner: members of pending SAR orgs see their status on every
  // portal page while they finish setup (operator decision 2026-07-26 —
  // pending orgs can assemble their team). No routing claim: nothing routes
  // alerts to SAR orgs yet (docs/plans/33 §4).
  const pendingNames = (
    await db
      .select({ name: sarOrgs.name })
      .from(orgMemberships)
      .innerJoin(sarOrgs, eq(sarOrgs.id, orgMemberships.orgId))
      .where(and(eq(orgMemberships.userId, userId), eq(sarOrgs.status, "pending")))
  ).map((o) => o.name);

  // Staff announcements for this viewer's audiences. A failed read hides the
  // banner rather than the page: announcements are advisory, and the page's
  // own data reads surface a real database outage.
  let notices: LiveAnnouncement[] = [];
  try {
    notices = await announcementsFor(userId, isStaff);
  } catch (err) {
    logger.error({ event: "announcements.read_failed", userId, err });
  }

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader viewer={viewer} signOut={<SignOutButton />} />

      {notices.map((n) => (
        <AnnouncementBanner key={n.id} message={n.message} severity={n.severity} endsAt={n.endsAt} />
      ))}

      {pendingNames.length > 0 ? (
        <div className="border-b bg-blue-50 dark:bg-blue-900/20">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 text-sm text-blue-900 dark:text-blue-200">
            <span>
              {pendingNames.join(", ")}{" "}
              is under review. You can keep setting up your
              organization and inviting teammates while we review it.
            </span>
            <Link href="/sar/pending" className="font-medium whitespace-nowrap underline">
              Review status
            </Link>
          </div>
        </div>
      ) : null}

      {gate === "nag" ? (
        <div className="border-b bg-amber-50 dark:bg-amber-900/20">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
            <span>Secure your account with two-factor authentication.</span>
            <Link href={ENROLL_PATH} className="font-medium whitespace-nowrap underline">
              Set up now
            </Link>
          </div>
        </div>
      ) : null}

      {/* The map takes the whole width; every other page keeps the reading column. */}
      <main className={`mx-auto w-full flex-1 px-4 ${pathname === "/map" ? "max-w-screen-2xl py-4" : "max-w-5xl py-8"}`}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
