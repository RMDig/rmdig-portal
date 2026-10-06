import Image from "next/image";
import Link from "next/link";

import { GITHUB_URL, HUGGING_FACE_URL } from "@/components/public/BrandIcons";
import { HeaderAvaiMark } from "@/components/public/HeaderAvaiMark";
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
          {/* AvAI mark → the in-depth /avai page, in the middle grid column: at
              true page center whenever both 1fr sides fit their content; a
              too-wide nav pushes it left instead of overlapping. Hidden on the
              landing page and /avai, which show it already. */}
          <HeaderAvaiMark />
          <nav className="col-start-3 flex items-center gap-5 justify-self-end text-sm text-neutral-600 dark:text-neutral-300">
            <div className="hidden items-center gap-5 md:flex">
              <Link href="/services" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Services
              </Link>
              <Link href="/research" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Research
              </Link>
              <Link href="/support" className="hover:text-neutral-900 dark:hover:text-neutral-100">
                Support
              </Link>
            </div>
            <SessionButton className="rounded-md bg-neutral-900 dark:bg-white px-3 py-1.5 font-medium text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200" />
            <MobileNav>
              <Link href="/avai">What is AvAI?</Link>
              <Link href="/services">Services</Link>
              <Link href="/research">Research</Link>
              <Link href="/support">Support</Link>
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
    </>
  );
}
