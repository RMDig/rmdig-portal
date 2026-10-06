import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { announcementsFor, type LiveAnnouncement } from "@/lib/announcements/queries";
import { auth } from "@/lib/auth";
import { userMfaGate } from "@/lib/auth/mfa-gate";
import { nextQuery } from "@/lib/auth/return-to";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { MobileNav } from "@/components/public/MobileNav";
import { SignOutButton } from "./SignOutButton";

const ENROLL_PATH = "/settings/mfa/enroll";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    // Back to the page they asked for after signing in (an invite, an AvServ
    // notice's account-review link), not always the dashboard.
    redirect(`/sign-in${nextQuery((await headers()).get("x-return-to"))}`);
  }
  const userId = session.user.id;

  // One roles read serves both the Admin nav and the MFA policy (admin_only).
  const { gate, roles } = await userMfaGate(userId);
  const isStaff = roles.length > 0;

  // Authoritative enforcement (see middleware.ts for why this lives here, not in
  // Edge middleware). The pathname comes from middleware so we don't loop the
  // user on the enrollment page itself.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (gate === "required" && pathname !== ENROLL_PATH) {
    redirect(ENROLL_PATH);
  }

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
      <header className="border-b">
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex shrink-0 items-center justify-self-start">
            {/* 326×96 source at 28px tall — same asset as the public header. */}
            <Image src="/rmdig-logo.png" alt="RMDig" width={95} height={28} priority />
          </Link>
          {/* AvAI mark → /avai. Middle grid column — true center when the sides fit; pushes
              (never overlaps) when the nav is wider than its share. */}
          <Link href="/avai" aria-label="What is AvAI?" className="hidden md:block">
            <Image
              src="/avai-logo.png"
              alt="AvAI"
              width={44}
              height={28}
              className="dark:hidden"
            />
            <Image
              src="/avai-logo-white.png"
              alt="AvAI"
              width={44}
              height={28}
              className="hidden dark:block"
            />
          </Link>
          {/* Unified nav (operator decision 2026-07-26): everything visible to
              the public stays reachable while signed in, with role tabs added.
              Below md the tabs live in the hamburger (MobileNav). */}
          <div className="col-start-3 flex items-center gap-4 justify-self-end text-sm">
            <nav className="hidden items-center gap-4 md:flex">
              <Link href="/map" className="text-muted-foreground hover:text-foreground">
                Map
              </Link>
              <Link href="/services" className="text-muted-foreground hover:text-foreground">
                Services
              </Link>
              <Link href="/research" className="text-muted-foreground hover:text-foreground">
                Research
              </Link>
              <Link href="/support" className="text-muted-foreground hover:text-foreground">
                Support
              </Link>
              {isStaff ? (
                <Link href="/admin" className="text-muted-foreground hover:text-foreground">
                  Admin
                </Link>
              ) : null}
            </nav>
            <span className="text-muted-foreground hidden lg:inline">
              {session.user.email}
            </span>
            {/* Settings as a gear, just left of Sign out (desktop; the
                hamburger lists it by name). */}
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="text-muted-foreground hover:text-foreground hidden md:block"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
            <SignOutButton />
            <MobileNav>
              <Link href="/map">Map</Link>
              <Link href="/avai">What is AvAI?</Link>
              <Link href="/services">Services</Link>
              <Link href="/research">Research</Link>
              <Link href="/support">Support</Link>
              {isStaff ? <Link href="/admin">Admin</Link> : null}
              <Link href="/settings">Settings</Link>
            </MobileNav>
          </div>
        </div>
      </header>

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

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
