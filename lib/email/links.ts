import { env } from "../env";

/** An absolute portal link for an email. NEXTAUTH_URL is set in every
 *  deployed environment; the localhost fallback is for local development. */
export function portalUrl(path: string): string {
  return `${env.NEXTAUTH_URL ?? "http://localhost:3000"}${path}`;
}
