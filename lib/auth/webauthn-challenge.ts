import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { env } from "../env";

// The one challenge a passkey ceremony signs (WebAuthn), held for five minutes
// in a signed, httpOnly cookie rather than a table: issued when the browser
// asks for options, read and cleared when the answer comes back, so one
// challenge serves one ceremony. Bound to its purpose, and for registration
// and re-authentication to the user, so a challenge for one can't be spent
// on another.

const COOKIE = "rmdig_webauthn";
const TTL_SECONDS = 5 * 60;

export type ChallengePurpose = "register" | "signin" | "reauth";

interface Payload {
  c: string;
  p: ChallengePurpose;
  u: string | null;
  e: number;
}

function key(): Buffer {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update("rmdig webauthn challenge v1").digest();
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

export async function issueChallenge(challenge: string, purpose: ChallengePurpose, userId: string | null): Promise<void> {
  const payload: Payload = { c: challenge, p: purpose, u: userId, e: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  (await cookies()).set(COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/** The challenge for `purpose` (and `userId`, when bound), or null when
 *  there's none, it expired, it's for something else, or it was tampered
 *  with. Always clears the cookie: a challenge is spent once. */
export async function consumeChallenge(purpose: ChallengePurpose, userId: string | null): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete(COOKIE);
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    // A signed body that doesn't parse can only be our own bug; refuse it.
    return null;
  }
  if (payload.p !== purpose || payload.e < Math.floor(Date.now() / 1000)) return null;
  if (payload.u !== userId) return null;
  return payload.c;
}
