import { eq } from "drizzle-orm";
import Link from "next/link";
import QRCode from "qrcode";

import { auth } from "@/lib/auth";
import { userMfaGate } from "@/lib/auth/mfa-gate";
import { safeReturnTo } from "@/lib/auth/return-to";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  totpKeyUri,
} from "@/lib/auth/mfa";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MfaEnrollForm } from "./MfaEnrollForm";

export const metadata = {
  title: "Set up two-factor — rmdig",
};

export default async function MfaEnrollPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Where the user was going when the portal sent them here, if anywhere.
  const next = safeReturnTo((await searchParams).next);
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }

  const [user] = await db
    .select({
      email: users.email,
      secret: users.totpSecretEncrypted,
      enabledAt: users.mfaEnabledAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    return redirectToSignIn();
  }

  // Already on — nothing to enroll. Manage it from Settings instead.
  if (user.enabledAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Two-factor authentication is already enabled on your account.
          </p>
          <Link href={next ?? "/settings"} className="text-foreground text-sm font-medium underline">
            {next ? "Continue" : "Back to settings"}
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Reuse a pending secret across refreshes so the user's authenticator entry
  // stays valid; only generate (and store, encrypted) when there isn't one.
  let secret: string;
  if (user.secret) {
    secret = decryptSecret(user.secret);
  } else {
    secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecretEncrypted: encryptSecret(secret) })
      .where(eq(users.id, session.user.id));
  }

  const qrDataUrl = await QRCode.toDataURL(totpKeyUri(user.email, secret));
  // Sent here because their role needs it: say why, rather than an
  // unexplained detour (a new team's admin arrives straight from applying).
  const { gate, roles } = await userMfaGate(session.user.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {gate === "required" ? (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">
            {roles.length > 0
              ? "rmdig staff accounts need two-factor authentication before using the portal."
              : "Your account needs two-factor authentication before you continue. Search & rescue team admins need it because they manage their team's members and terms. It takes about a minute."}
            {next ? " You'll go straight back to where you were afterwards." : null}
          </p>
        ) : null}
        <MfaEnrollForm qrDataUrl={qrDataUrl} secret={secret} next={next} />
      </CardContent>
    </Card>
  );
}
