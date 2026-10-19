import { headers } from "next/headers";

// Which relying party a passkey ceremony is for, from the host the browser is
// on. The production host is rmdig.ai (app. and www. 308 there, middleware.ts),
// so production passkeys are scoped to rmdig.ai. A preview's passkey belongs to
// that preview's own host; local dev is localhost. Anything else is refused
// rather than guessed, since a wrong RP ID makes every passkey fail.

export const RP_NAME = "rmdig";

export interface RelyingParty {
  rpID: string;
  origin: string;
}

/** The relying party for `host` (a Host header value), or null to refuse. */
export function relyingPartyFor(host: string | null): RelyingParty | null {
  if (!host) return null;
  const h = host.toLowerCase();
  if (h === "rmdig.ai") return { rpID: "rmdig.ai", origin: "https://rmdig.ai" };
  const local = /^(localhost)(:\d{1,5})?$/.exec(h);
  if (local) return { rpID: "localhost", origin: `http://${h}` };
  if (/^[a-z0-9-]+\.vercel\.app$/.test(h)) return { rpID: h, origin: `https://${h}` };
  return null;
}

/** The relying party for this request, or a loud error. */
export async function currentRelyingParty(): Promise<RelyingParty> {
  const h = await headers();
  const rp = relyingPartyFor(h.get("x-forwarded-host") ?? h.get("host"));
  if (!rp) throw new Error("Passkeys aren't available on this host");
  return rp;
}
