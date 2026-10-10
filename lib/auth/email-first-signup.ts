import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../db";
import { users, verificationTokens } from "../db/schema";
import { hashVerificationToken } from "./verification-tokens";

// Email-first sign-up (beta plan D1a). Sign-up stores only the address; the
// password is chosen on the page the emailed link opens, so no password exists
// until someone has proved they read that inbox. Before this, a stranger could
// sign up with someone else's address and their own password, and the owner
// clicking the verification email made the stranger's password valid.
//
// Opening the link only checks it (checkSignUpLink). Mail scanners fetch links
// on delivery, so a GET must not use the token up. Submitting the password
// form claims it (finishSignUp).

export type SignUpLinkState = "ok" | "invalid" | "expired";

/** Whether this link can still finish sign-up. Read-only. */
export async function checkSignUpLink(email: string, token: string): Promise<SignUpLinkState> {
  const [vt] = await db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, email), eq(verificationTokens.token, hashVerificationToken(token))))
    .limit(1);
  if (!vt) return "invalid";
  return vt.expires.getTime() > Date.now() ? "ok" : "expired";
}

/**
 * Use the link up and set the account's first password, marking the address
 * verified. Returns the user id, or null when the link is no longer valid or
 * the account is already verified.
 *
 * Deleting the token is the claim, so two submits of one link can't both set
 * a password. The update only takes an unverified row: a verified account
 * changes its password through reset, which also signs out its sessions. An
 * unverified row from before email-first sign-up may still carry a password a
 * stranger chose; it is replaced here.
 */
export async function finishSignUp(params: {
  email: string;
  token: string;
  passwordHash: string;
}): Promise<string | null> {
  const { email, token, passwordHash } = params;
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, email),
          eq(verificationTokens.token, hashVerificationToken(token)),
          gt(verificationTokens.expires, new Date()),
        ),
      )
      .returning({ identifier: verificationTokens.identifier });
    if (!claimed) return null;

    const [user] = await tx
      .update(users)
      .set({ passwordHash, emailVerified: new Date() })
      .where(and(eq(users.email, email), isNull(users.emailVerified)))
      .returning({ id: users.id });
    return user?.id ?? null;
  });
}
