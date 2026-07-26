import Image from "next/image";
import Link from "next/link";

import { LEGAL_ENTITY } from "@/lib/legal/compliance-copy";

// Shared chrome for every no-auth public surface (landing, privacy, terms,
// support, data-deletion). These routes are store-submission gates (AvApp doc
// 24 §1.4): App Store Connect and Play Console fetch them with no session, so
// nothing under this group may import auth or gate on a user. Keep it static.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center">
            {/* 326×96 source rendered at 32px tall — 3x for retina crispness. */}
            <Image
              src="/rmdig-logo.png"
              alt="RMDig"
              width={109}
              height={32}
              priority
            />
          </Link>
          <nav className="flex items-center gap-5 text-sm text-neutral-600 dark:text-neutral-300">
            <Link href="/models" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Models
            </Link>
            <Link
              href="/snowpack_dataset"
              className="hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Data
            </Link>
            <Link href="/support" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Support
            </Link>
            <Link
              href="/sign-in"
              className="rounded-md bg-neutral-900 dark:bg-white px-3 py-1.5 font-medium text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-8 text-sm text-neutral-500 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>
              © {new Date().getFullYear()} {LEGAL_ENTITY}
            </p>
            {/* Trademark attribution — ™ (not ®) until the registration has
                formally issued; swap then. */}
            <p className="text-xs">
              AvAI™ and the AvAI logo are trademarks of {LEGAL_ENTITY}.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Terms of Service
            </Link>
            <Link href="/support" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Support
            </Link>
            <Link href="/account/delete" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Delete my data
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
