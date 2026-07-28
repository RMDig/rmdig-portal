import Image from "next/image";
import Link from "next/link";

import { MobileNav } from "@/components/public/MobileNav";
import { SessionButton } from "@/components/public/SessionButton";
import { LEGAL_ENTITY } from "@/lib/legal/compliance-copy";

// Shared chrome for every no-auth public surface (landing, privacy, terms,
// support, data-deletion). These routes are store-submission gates (AvApp doc
// 24 §1.4): App Store Connect and Play Console fetch them with no session, so
// nothing under this group may import auth or gate on a user. Keep it static.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-4">
          <Link href="/" className="flex items-center justify-self-start">
            {/* 326×96 source rendered at 32px tall — 3x for retina crispness. */}
            <Image
              src="/rmdig-logo.png"
              alt="RMDig"
              width={109}
              height={32}
              priority
            />
          </Link>
          {/* AvAI mark → the in-depth /avai page. Middle grid column: the
              mark sits at TRUE page center whenever
              both 1fr sides fit their content; a too-wide nav pushes it left
              instead of overlapping (grid min-content floor). */}
          <Link href="/avai" aria-label="What is AvAI?" className="hidden md:block">
            <Image
              src="/avai-logo.png"
              alt="AvAI"
              width={50}
              height={32}
              className="dark:hidden"
            />
            <Image
              src="/avai-logo-white.png"
              alt="AvAI"
              width={50}
              height={32}
              className="hidden dark:block"
            />
          </Link>
          <nav className="col-start-3 flex items-center gap-5 justify-self-end text-sm text-neutral-600 dark:text-neutral-300">
            <div className="hidden items-center gap-5 md:flex">
            <Link href="/models" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Models
            </Link>
            <Link
              href="/snowpack_dataset"
              className="hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Data
            </Link>
            <Link href="/methods" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Methods
            </Link>
            <Link href="/support" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              Support
            </Link>
            </div>
            <SessionButton className="rounded-md bg-neutral-900 dark:bg-white px-3 py-1.5 font-medium text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200" />
            {/* Code & model hosting, pinned to the far right (desktop). */}
            <div className="hidden items-center gap-5 md:flex">
            <a
              href="https://github.com/RMDig"
              aria-label="RMDig on GitHub"
              rel="noopener"
              className="hover:text-neutral-900 dark:hover:text-neutral-100"
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
              <a href="https://github.com/RMDig" rel="noopener">
                GitHub
              </a>
              <a href="https://huggingface.co/RMDig" rel="noopener">
                Hugging Face 🤗
              </a>
            </MobileNav>
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
