import { isIP } from "node:net";

import { headers } from "next/headers";

// First hop of x-forwarded-for is the client IP on Vercel (the platform
// appends, so the leftmost entry is what reached the edge).
async function forwardedIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

// For IP-keyed rate limits. Headerless requests (local dev, direct invocation)
// share one "unknown" bucket rather than bypassing the limit — fail closed, not
// open.
export async function clientIp(): Promise<string> {
  return (await forwardedIp()) ?? "unknown";
}

/**
 * The browser's IP as evidence (AvServ agreement acceptance, contract
 * account_agreement.md §4): a syntactically valid address or null. Never a
 * placeholder and never the portal's own address — a caller that gets null
 * must refuse the action rather than record something that isn't the browser.
 */
export async function browserIp(): Promise<string | null> {
  const ip = await forwardedIp();
  return ip && isIP(ip) !== 0 ? ip : null;
}
