import Link from "next/link";

import { SessionsList, type SessionRow } from "./SessionsList";
import { auth } from "@/lib/auth";
import { listSessions } from "@/lib/auth/sessions";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { describeUserAgent } from "@/lib/format/user-agent";
import { formatMountain } from "@/lib/format/time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Sessions — rmdig",
};

// The browsers signed in to this account (plan 36 §3.3). Phones running AvAI are
// on Settings → Devices; these are web sign-ins to the portal.
export default async function SessionsPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();

  const rows: SessionRow[] = (await listSessions(session.user.id)).map((s) => ({
    id: s.id,
    label: describeUserAgent(s.userAgent),
    signedIn: formatMountain(s.createdAt),
    lastActive: formatMountain(s.lastSeenAt ?? s.createdAt),
    current: s.current,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-muted-foreground text-sm">
          <Link href="/settings" className="hover:text-foreground underline">
            Settings
          </Link>{" "}
          / Sessions
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Where you&apos;re signed in</CardTitle>
          <CardDescription>
            Browsers signed in to your rmdig account. If you don&apos;t recognise one, sign it
            out and change your password. Phones running AvAI are under{" "}
            <Link href="/settings/devices" className="underline">
              Devices
            </Link>
            . &quot;Last active&quot; updates about once a day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionsList sessions={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
