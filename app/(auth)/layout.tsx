import Link from "next/link";

import { SiteFooter } from "@/components/nav/SiteFooter";

// Sign-in, sign-up and password pages: a way back to the site and the usual
// footer links, without the full header (its Sign in button would point at
// the page you're on, and each form already shows the logo).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 py-4 text-sm">
          <Link href="/" className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
            ← Back to rmdig.ai
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
