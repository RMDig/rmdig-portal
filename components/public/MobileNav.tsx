"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

// Small-screen disclosure menu shared by the public and portal headers: a
// hamburger that reveals the nav links which don't fit in a phone-width
// header row. Pure client state, no auth/session knowledge — callers pass
// whatever links belong to their context as children (keeps the (public)
// layout §3.7-clean). The panel closes on any click inside it, so link
// navigation dismisses it naturally.
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100 flex items-center p-1"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <div
          onClick={() => setOpen(false)}
          className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-1 rounded-md border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-950 [&_a]:rounded [&_a]:px-3 [&_a]:py-2 [&_a:hover]:bg-neutral-100 dark:[&_a:hover]:bg-neutral-900"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
