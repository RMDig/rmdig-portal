"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { HeaderAvaiMark } from "@/components/public/HeaderAvaiMark";
import { MobileNav } from "@/components/public/MobileNav";
import type { NavViewer } from "@/lib/nav/types";

// The one site header, on public and portal pages alike, so a signed-in
// user keeps the same tabs moving from the dashboard to Research and back.
// Support lives in the footer (and the mobile menu), not the header bar, to
// keep the bar narrow; Admin sits with the account controls, after Settings.
//
// The portal layout passes `viewer` from the session. The public layout
// can't read the session (CLAUDE.md §3.7: those pages are store-submission
// gates that must not depend on auth or the database), so it passes
// `viewer="probe"` and the header asks /api/nav after hydration. Until then,
// or if that fails, it shows the signed-out header: degraded, never broken.

type Tab = { href: string; label: string };

function tabsFor(viewer: NavViewer | null): Tab[] {
  return [
    ...(viewer?.hasMap ? [{ href: "/map", label: "Map" }] : []),
    { href: "/services", label: "Services" },
    { href: "/research", label: "Research" },
  ];
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** The signed-in viewer for a public page, from /api/nav; null while unknown or signed out. */
function useProbedViewer(enabled: boolean): NavViewer | null {
  const [viewer, setViewer] = useState<NavViewer | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/nav")
      .then((r) => (r.ok ? (r.json() as Promise<{ viewer: NavViewer | null }>) : null))
      .then((body) => {
        if (!cancelled && body?.viewer) setViewer(body.viewer);
      })
      .catch(() => {
        // Benign: the signed-out header stands, and the page itself is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return viewer;
}

export function SiteHeader({
  viewer: given,
  signOut,
}: {
  /** The signed-in viewer (portal), or "probe" to ask /api/nav (public pages). */
  viewer: NavViewer | "probe";
  /** The portal's sign-out control; public pages link to the dashboard instead. */
  signOut?: React.ReactNode;
}) {
  const pathname = usePathname();
  const probed = useProbedViewer(given === "probe");
  const viewer = given === "probe" ? probed : given;
  const tabs = tabsFor(viewer);
  const tabClass = (href: string) =>
    isActive(pathname, href)
      ? "font-medium text-neutral-900 dark:text-neutral-50"
      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100";

  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-4">
        <Link href={viewer ? "/dashboard" : "/"} className="flex items-center justify-self-start">
          {/* 326×96 source rendered at 32px tall — 3x for retina crispness. */}
          <Image src="/rmdig-logo.png" alt="RMDig" width={109} height={32} priority />
        </Link>
        {/* AvAI mark → /avai in the middle column (hidden where the page shows it already). */}
        <HeaderAvaiMark />
        <div className="col-start-3 flex items-center gap-4 justify-self-end text-sm">
          <nav aria-label="Main" className="hidden items-center gap-5 md:flex">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} aria-current={isActive(pathname, t.href) ? "page" : undefined} className={tabClass(t.href)}>
                {t.label}
              </Link>
            ))}
          </nav>
          {viewer ? (
            <>
              <span className="hidden text-neutral-500 xl:inline dark:text-neutral-400">{viewer.email}</span>
              <Link
                href="/settings"
                aria-label="Settings"
                title="Settings"
                className="hidden text-neutral-600 hover:text-neutral-900 md:block dark:text-neutral-300 dark:hover:text-neutral-100"
              >
                <GearIcon />
              </Link>
              {viewer.isStaff ? (
                <Link
                  href="/admin"
                  aria-current={isActive(pathname, "/admin") ? "page" : undefined}
                  className={`hidden md:block ${tabClass("/admin")}`}
                >
                  Admin
                </Link>
              ) : null}
              {signOut ?? (
                <Link
                  href="/dashboard"
                  className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  Dashboard
                </Link>
              )}
            </>
          ) : (
            <>
              <Link href="/sign-up" className="hidden text-neutral-600 hover:text-neutral-900 sm:inline dark:text-neutral-300 dark:hover:text-neutral-100">
                Create account
              </Link>
              <Link
                href="/sign-in"
                className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Sign in
              </Link>
            </>
          )}
          <MobileNav>
            {viewer ? <Link href="/dashboard">Dashboard</Link> : null}
            {viewer?.hasMap ? <Link href="/map">Map</Link> : null}
            <Link href="/avai">What is AvAI?</Link>
            <Link href="/services">Services</Link>
            <Link href="/research">Research</Link>
            <Link href="/support">Support</Link>
            {viewer?.isStaff ? <Link href="/admin">Admin</Link> : null}
            {viewer ? <Link href="/settings">Settings</Link> : <Link href="/sign-up">Create account</Link>}
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
