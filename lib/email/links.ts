import { env } from "../env";

/** An absolute portal link for an email. lib/env requires NEXTAUTH_URL in
 *  production. A preview has none, so its links point at the preview itself
 *  (VERCEL_URL); before, they pointed at localhost, which broke verification
 *  and invite links on previews that send real email (2026-10-08). Local
 *  development falls back to localhost. */
export function portalUrl(path: string): string {
  if (env.NEXTAUTH_URL) return `${env.NEXTAUTH_URL}${path}`;
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}${path}`;
  return `http://localhost:3000${path}`;
}
