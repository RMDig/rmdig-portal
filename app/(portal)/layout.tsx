import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { evaluateMfaGate } from "@/lib/auth/mfa-enforcement";
import { getPlatformRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
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

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center">
            {/* 326×96 source at 28px tall — same asset as the public header. */}
            <Image src="/rmdig-logo.png" alt="RMDig" width={95} height={28} priority />
          </Link>
          {/* AvAI mark, truly centered (absolute, so the flex row's uneven
              sides can't skew it); hidden on small screens where it would
              collide with the nav. Theme pair per the landing hero. */}
          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
            {/* 600×384 asset — 56×36 keeps the exact 1.5625 aspect (no squish). */}
            <Image
              src="/avai-logo.png"
              alt="AvAI"
              width={56}
              height={36}
              className="dark:hidden"
            />
            <Image
              src="/avai-logo-white.png"
              alt="AvAI"
              width={56}
              height={36}
              className="hidden dark:block"
            />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {isStaff ? (
              <Link href="/admin" className="text-muted-foreground hover:text-foreground">
                Admin
              </Link>
            ) : null}
            <Link href="/settings" className="text-muted-foreground hover:text-foreground">
              Settings
            </Link>
            <span className="text-muted-foreground">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

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
