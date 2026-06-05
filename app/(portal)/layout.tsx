import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { SignOutButton } from "./SignOutButton";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Admin nav appears only for rmdig staff (any platform role). Fetched here
  // rather than from the session so the session stays lean.
  const showAdmin = await isPlatformStaff(session.user.id);

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            rmdig
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {showAdmin ? (
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
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
