import Link from "next/link";

import { GITHUB_URL, HUGGING_FACE_URL } from "@/components/public/BrandIcons";
import { LEGAL_ENTITY } from "@/lib/legal/compliance-copy";

// The one site footer, on public, portal and sign-in pages, so Privacy,
// Terms, Support, data deletion and Status are a click away everywhere.
// Static and auth-free (the public layout renders it, CLAUDE.md §3.7).
export function SiteFooter() {
  return (
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
          <Link href="/status" className="hover:text-neutral-900 dark:hover:text-neutral-100">
            Status
          </Link>
          <a href={GITHUB_URL} rel="noopener" className="hover:text-neutral-900 dark:hover:text-neutral-100">
            GitHub
          </a>
          <a href={HUGGING_FACE_URL} rel="noopener" className="hover:text-neutral-900 dark:hover:text-neutral-100">
            Hugging Face
          </a>
        </nav>
      </div>
    </footer>
  );
}
