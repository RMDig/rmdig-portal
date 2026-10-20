import type { ErrorEvent } from "@sentry/nextjs";

// Sentry's beforeSend for every runtime (server, edge, browser). Imported by
// sentry.edge.config.ts, so it must stay free of lib/env and anything else
// server-only (CLAUDE.md §3.6).
//
// What leaves the portal for Sentry: no email addresses (users, SAR members,
// deletion requesters: an email in a CPA deletion request is exactly what must
// not be copied elsewhere), no phone numbers or IP addresses (plan 36 H6), no
// cookies or auth headers, no tokens in URLs (reset, invite and deletion links
// carry them in the query string).

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// E.164 (the form every stored phone takes) and US formats people type.
const PHONE = /\+\d{8,15}\b|\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Five or more hex groups, so a time like 12:34:56 is left alone.
const IPV6 = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi;
const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-avai-signature", "proxy-authorization"]);
const MAX_DEPTH = 8;

export function scrubString(s: string): string {
  return s
    .replace(EMAIL, "[email]")
    .replace(/([?&](?:token|code)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(IPV6, "[ip]")
    .replace(IPV4, "[ip]")
    .replace(PHONE, "[phone]");
}

export function scrubValue(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return scrubString(v);
  if (depth >= MAX_DEPTH || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = scrubValue(x, depth + 1);
  return out;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  if (event.tags) event.tags = scrubValue(event.tags) as typeof event.tags;
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubString(b.message);
    if (b.data) b.data = scrubValue(b.data) as typeof b.data;
  }
  if (event.user) {
    // The user id is enough to find the account; nothing that identifies a person.
    event.user = event.user.id === undefined ? undefined : { id: event.user.id };
  }
  const req = event.request;
  if (req) {
    if (req.url) req.url = scrubString(req.url);
    if (typeof req.query_string === "string") req.query_string = scrubString(req.query_string);
    delete req.cookies;
    delete req.data;
    if (req.headers) {
      for (const k of Object.keys(req.headers)) {
        if (SECRET_HEADERS.has(k.toLowerCase())) delete req.headers[k];
      }
    }
  }
  return event;
}
