import { env } from "../env";

/** An absolute portal link for an email. lib/env requires NEXTAUTH_URL in
 *  production; the localhost fallback is for local development and previews
 *  (which log email instead of sending it). */
export function portalUrl(path: string): string {
  return `${env.NEXTAUTH_URL ?? "http://localhost:3000"}${path}`;
}
