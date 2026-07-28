import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { evaluateMfaGate } from "@/lib/auth/mfa-enforcement";
import { getPlatformRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { orgMemberships, sarOrgs, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { MobileNav } from "@/components/public/MobileNav";
import { SignOutButton } from "./SignOutButton";

const ENROLL_PATH = "/settings/mfa/enroll";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  const userId = session.user.id;

  // One roles read serves both the Admin nav and the MFA policy (admin_only).
  const roles = await getPlatformRoles(userId);
  const isStaff = roles.length > 0;

  const [row] = await db
    .select({ mfaEnabledAt: users.mfaEnabledAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const gate = evaluateMfaGate({
    enforcement: env.MFA_ENFORCEMENT,
    mfaEnabled: !!row?.mfaEnabledAt,
    isStaff,
  });

  // Authoritative enforcement (see middleware.ts for why this lives here, not in
  // Edge middleware). The pathname comes from middleware so we don't loop the
  // user on the enrollment page itself.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (gate === "required" && pathname !== ENROLL_PATH) {
    redirect(ENROLL_PATH);
  }

  // Under-review banner: members of pending SAR orgs see their status on every
  // portal page while they finish setup (operator decision 2026-07-26 —
  // pending orgs can assemble their team; approval alone turns on routing).
  const pendingNames = (
    await db
      .select({ name: sarOrgs.name })
      .from(orgMemberships)
      .innerJoin(sarOrgs, eq(sarOrgs.id, orgMemberships.orgId))
      .where(and(eq(orgMemberships.userId, userId), eq(sarOrgs.status, "pending")))
  ).map((o) => o.name);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex shrink-0 items-center">
            {/* 326×96 source at 28px tall — same asset as the public header. */}
            <Image src="/rmdig-logo.png" alt="RMDig" width={95} height={28} priority />
          </Link>
          {/* AvAI mark → /avai, centered in the free space between wordmark
              and nav (flex — the tabs flow around it, no overlap possible).
              Hidden below md; the hamburger carries the link there. */}
          <div className="hidden flex-1 justify-center md:flex">
          <Link href="/avai" aria-label="What is AvAI?">
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
          </div>
          {/* Unified nav (operator decision 2026-07-26): everything visible to
              the public stays reachable while signed in, with role tabs added.
              Below md the tabs live in the hamburger (MobileNav). */}
          <div className="flex items-center gap-4 text-sm">
            <nav className="hidden items-center gap-4 md:flex">
              <Link href="/models" className="text-muted-foreground hover:text-foreground">
                Models
              </Link>
              <Link
                href="/snowpack_dataset"
                className="text-muted-foreground hover:text-foreground"
              >
                Data
              </Link>
              <Link href="/methods" className="text-muted-foreground hover:text-foreground">
                Methods
              </Link>
              <Link href="/support" className="text-muted-foreground hover:text-foreground">
                Support
              </Link>
            </nav>
            <div className="hidden items-center gap-4 md:flex">
            {isStaff ? (
              <Link href="/admin" className="text-muted-foreground hover:text-foreground">
                Admin
              </Link>
            ) : null}
            <Link href="/settings" className="text-muted-foreground hover:text-foreground">
              Settings
            </Link>
            </div>
            <span className="text-muted-foreground hidden lg:inline">
              {session.user.email}
            </span>
            <SignOutButton />
            {/* Code & model hosting, pinned to the very far right (mirrors the
                public header; desktop only — the hamburger carries them on
                phones). */}
            <div className="hidden items-center gap-3 md:flex">
            <a
              href="https://github.com/RMDig"
              aria-label="RMDig on GitHub"
              rel="noopener"
              className="text-muted-foreground hover:text-foreground"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
            <a
              href="https://huggingface.co/RMDig"
              aria-label="RMDig on Hugging Face"
              rel="noopener"
              className="text-base leading-none"
            >
              <span aria-hidden>🤗</span>
            </a>
            </div>
            <MobileNav>
              <Link href="/avai">What is AvAI?</Link>
              <Link href="/models">Models</Link>
              <Link href="/snowpack_dataset">Data</Link>
              <Link href="/methods">Methods</Link>
              <Link href="/support">Support</Link>
              {isStaff ? <Link href="/admin">Admin</Link> : null}
              <Link href="/settings">Settings</Link>
              <a href="https://github.com/RMDig" rel="noopener">
                GitHub
              </a>
              <a href="https://huggingface.co/RMDig" rel="noopener">
                Hugging Face 🤗
              </a>
            </MobileNav>
          </div>
        </div>
      </header>

      {pendingNames.length > 0 ? (
        <div className="border-b bg-blue-50 dark:bg-blue-900/20">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-2 text-sm text-blue-900 dark:text-blue-200">
            <span>
              {pendingNames.join(", ")} is under review. You can keep setting up your
              organization and inviting teammates — alert routing turns on once it&apos;s
              approved.
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
