// The full Content-Security-Policy (plan 36 H1, beta blocker B6). Pure and
// env-free: middleware.ts imports it into the Edge bundle (CLAUDE.md §3.6) and
// passes in what it reads from process.env.
//
// It ships as Report-Only first (owner decision S-D9: one week, then a one-line
// enforce change). It must be the only CSP header a page gets (middleware.ts
// says why), so it carries the old baseline directives too.

/** Map hosts (components/map/basemap.ts): MapTiler's style, tiles, glyphs and
 *  sprites, and the OpenStreetMap raster fallback. MapLibre fetches them, so
 *  they are connect-src; img-src covers anything drawn from them. */
const MAP_HOSTS = ["https://api.maptiler.com", "https://tile.openstreetmap.org"];

/** Where the Google sign-in form ends up. Chrome applies form-action to the
 *  redirect after a form post, and /api/auth/signin/google redirects here. */
const FORM_HOSTS = ["https://accounts.google.com"];

export type CspOptions = {
  nonce: string;
  /** `next dev` needs eval for React Refresh and a websocket for HMR. */
  dev: boolean;
  /** NEXT_PUBLIC_SENTRY_DSN: the browser SDK posts to its host. */
  sentryDsn?: string;
  /** Sentry's security endpoint, from sentryReportUri; omit to report nowhere. */
  reportUri?: string;
};

/** A fresh nonce per request: 16 random bytes, base64. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function dsnParts(dsn: string | undefined): { origin: string; key: string; project: string } | null {
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    // A malformed DSN already turns the browser SDK off (it can't parse it
    // either); the policy then simply has no Sentry host.
    return null;
  }
  const project = url.pathname.split("/").filter(Boolean).pop();
  if (url.protocol !== "https:" || !url.username || !project) return null;
  return { origin: url.origin, key: url.username, project };
}

/** Sentry's CSP report endpoint for a DSN, tagged with the environment and
 *  release so reports group with the deployment that sent them. */
export function sentryReportUri(dsn: string | undefined, environment?: string, release?: string): string | undefined {
  const d = dsnParts(dsn);
  if (!d) return undefined;
  const q = new URLSearchParams({ sentry_key: d.key });
  if (environment) q.set("sentry_environment", environment);
  if (release) q.set("sentry_release", release);
  return `${d.origin}/api/${d.project}/security/?${q.toString()}`;
}

export function buildCsp(o: CspOptions): string {
  const sentry = dsnParts(o.sentryDsn)?.origin;
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    // strict-dynamic: scripts Next's nonced boot scripts load are trusted, so
    // no host list is needed for our own chunks. JSON-LD blocks are data, not
    // script, and need no nonce.
    ["script-src", "'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    // Inline style= attributes (16 call sites) and MapLibre's own.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", ...MAP_HOSTS],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...MAP_HOSTS, ...(sentry ? [sentry] : []), ...(o.dev ? ["ws:"] : [])],
    // The MapLibre tile worker is a hashed static file (load-maplibre.ts).
    ["worker-src", "'self'", "blob:"],
    ["frame-src", "'none'"],
    ["form-action", "'self'", ...FORM_HOSTS],
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
  ];
  if (o.reportUri) directives.push(["report-uri", o.reportUri], ["report-to", "csp"]);
  return directives.map((d) => d.join(" ")).join("; ");
}

/** The maintenance 503 page is one static document with an inline <style>
 *  and no script, so it gets a closed, enforced policy of its own. */
export const MAINTENANCE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
