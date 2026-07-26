"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The (public) layout must never import lib/auth (CLAUDE.md §3.7 — these are
// store-submission gates whose availability can't depend on auth or the DB).
// But a signed-in user clicking a public tab shouldn't be shown "Sign in" as
// if their session vanished. This client enhancement probes next-auth's
// public session endpoint after hydration and swaps the button to
// "Dashboard" when a session exists. Pages stay fully static; if the probe
// fails for any reason we render the anonymous default — degradation, never
// breakage.
export function SessionButton({ className }: { className?: string }) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { user?: unknown } | null) => {
        if (!cancelled && s?.user) setAuthed(true);
      })
      .catch(() => {
        // Anonymous default stands; the probe is best-effort by design.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link href={authed ? "/dashboard" : "/sign-in"} className={className}>
      {authed ? "Dashboard" : "Sign in"}
    </Link>
  );
}
