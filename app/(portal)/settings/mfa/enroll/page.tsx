import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";

import { auth } from "@/lib/auth";
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

export default async function MfaEnrollPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
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
    redirect("/sign-in");
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
          <Link href="/settings" className="text-foreground text-sm font-medium underline">
            Back to settings
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent>
        <MfaEnrollForm qrDataUrl={qrDataUrl} secret={secret} />
      </CardContent>
    </Card>
  );
}
