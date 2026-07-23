import Link from "next/link";

import { LEGAL_ENTITY } from "@/lib/legal/compliance-copy";

// Shared chrome for every no-auth public surface (landing, privacy, terms,
// support, data-deletion). These routes are store-submission gates (AvApp doc
// 24 §1.4): App Store Connect and Play Console fetch them with no session, so
// nothing under this group may import auth or gate on a user. Keep it static.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            rmdig<span className="text-neutral-400"> / AvAI</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-neutral-600">
            <Link href="/support" className="hover:text-neutral-900">
              Support
            </Link>
            <Link
              href="/sign-in"
              className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-8 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {LEGAL_ENTITY}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/privacy" className="hover:text-neutral-900">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-neutral-900">
              Terms of Service
            </Link>
            <Link href="/support" className="hover:text-neutral-900">
              Support
            </Link>
            <Link href="/account/delete" className="hover:text-neutral-900">
              Delete my data
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
