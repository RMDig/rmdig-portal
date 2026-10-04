import { z } from "zod";

// The planned-maintenance switch for the portal (docs/runbook.md "Portal
// maintenance switch"). The operator sets the `portalMaintenance` key in the
// project's Vercel Global Config (formerly Edge Config); within ~30 s the Edge
// middleware answers portal routes with a static 503 page, without a redeploy
// and without the database, so it works mid-upgrade.
//
// Bundled into the Edge middleware: no lib/env, no logger, no DB (CLAUDE.md
// §3.6). Everything here except readSwitch is pure and unit-tested.

export const SWITCH_KEY = "portalMaintenance";

export const MaintenanceSwitch = z.object({
  enabled: z.boolean(),
  // Shown verbatim to every visitor, so it is public copy: no internal detail.
  message: z.string().max(300).optional(),
  // ISO 8601 end time, shown to visitors and used for Retry-After.
  endsAt: z.string().datetime({ offset: true }).optional(),
});
export type MaintenanceSwitch = z.infer<typeof MaintenanceSwitch>;

// Routes that stay up during maintenance: the store-submission and carrier
// gates (CLAUDE.md §3.7), the rest of the public site, and the probes.
// tests/unit/portal-maintenance.test.ts fails if a route under app/(public)
// is missing here.
export const STAYS_UP = [
  "/",
  "/account/delete",
  "/alerts",
  "/avai",
  "/contribute",
  "/methods", // redirects to /research/methods
  "/models", // redirects to /research/models
  "/privacy",
  "/research",
  "/services",
  "/sms",
  "/snowpack_dataset",
  "/support",
  "/terms",
  "/healthz",
  "/readyz",
  // Team alerts from AvServ keep arriving during portal maintenance whenever
  // the database is up (sar_portal_intake.md).
  "/api/sar/intake",
] as const;

export function staysUp(pathname: string): boolean {
  return STAYS_UP.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/** A config value that doesn't parse is ignored (and logged by the caller),
 *  never treated as "on": a typo must not take the portal down. */
export function parseSwitch(value: unknown): MaintenanceSwitch | null {
  const parsed = MaintenanceSwitch.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Seconds until endsAt, clamped to 1–60 minutes; 5 minutes when unknown. */
export function retryAfterSeconds(sw: MaintenanceSwitch, now: Date): number {
  if (!sw.endsAt) return 300;
  const secs = Math.ceil((Date.parse(sw.endsAt) - now.getTime()) / 1000);
  return Math.min(3600, Math.max(60, secs));
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The static maintenance page. Mountain time, since that's where AvAI runs
 *  and where the operator writes the window. */
export function maintenancePage(sw: MaintenanceSwitch): string {
  const until = sw.endsAt
    ? new Date(sw.endsAt).toLocaleString("en-US", {
        timeZone: "America/Denver",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;
  const body = sw.message ?? "We're updating the portal and will be back shortly.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Down for maintenance | rmdig</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Helvetica,Arial,sans-serif;background:#fafafa;color:#171717}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#525252;line-height:1.5}a{color:inherit}
@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#f5f5f5}p{color:#a3a3a3}}</style></head>
<body><main><h1>The portal is down for maintenance</h1>
<p>${escape(body)}</p>${until ? `\n<p>Expected back by ${escape(until)}.</p>` : ""}
<p><a href="/support">Support</a> · <a href="/privacy">Privacy</a> · <a href="/">rmdig.ai</a></p></main></body></html>`;
}

// ── The one impure part ──────────────────────────────────────────────────────
// Read once per ~30 s per Edge instance: the Hobby plan includes 100k Global
// Config reads a month, and public pages and assets never read at all.
const CACHE_MS = 30_000;
let cache: { at: number; value: MaintenanceSwitch | null } | null = null;

export async function readSwitch(
  read: (key: string) => Promise<unknown>,
  now = Date.now(),
): Promise<MaintenanceSwitch | null> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  let value: MaintenanceSwitch | null = null;
  try {
    const raw = await read(SWITCH_KEY);
    value = raw === undefined ? null : parseSwitch(raw);
    if (raw !== undefined && value === null) {
      console.error(JSON.stringify({ event: "maintenance.switch_invalid" }));
    }
  } catch (err) {
    // Fail open: an unreachable config store must never take the portal down.
    console.error(JSON.stringify({ event: "maintenance.switch_unreadable", error: String(err) }));
  }
  cache = { at: now, value };
  return value;
}

/** Test seam: forget the cached value. */
export function resetSwitchCache(): void {
  cache = null;
}
