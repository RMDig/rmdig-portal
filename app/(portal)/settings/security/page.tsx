import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NoticesToggle } from "./NoticesToggle";
import { auth } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { loadSecurityView } from "@/lib/auth/security-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatMountain } from "@/lib/format/time";

export const metadata = {
  title: "Security — rmdig",
};

// The account's security history and the notice switch (plan 36 §5.2–§5.3).
// The history itself is sensitive (someone holding a signed-in browser could
// learn when the owner changed things), so the page needs a recent login.
export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const userId = session.user.id;
  if (!(await requireRecentAuth(userId)).ok) {
    redirect(`/settings/reauth?returnTo=${encodeURIComponent("/settings/security")}`);
  }

  const [user] = await db
    .select({ accountId: users.avservAccountId, noticesAt: users.securityNoticesAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const view = await loadSecurityView(userId, user?.accountId ?? null);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm">
          <Link href="/settings" className="hover:text-foreground underline">
            Settings
          </Link>{" "}
          / Security
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security notices</CardTitle>
          <CardDescription>
            {user?.noticesAt
              ? "On. We email your account address when a security change happens, without saying what changed."
              : "Off. Turn them on to get an email when a security change happens on your account. They're off by default because someone else may be able to read your email."}{" "}
            Changes made on a phone reach you within a day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NoticesToggle on={!!user?.noticesAt} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent security activity</CardTitle>
          <CardDescription>
            Changes to your sign-in, your browsers and your phones. If you don&apos;t recognise
            one, change your password and sign out the browsers and phones you don&apos;t know.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {view.incomplete ? (
            <p className="text-muted-foreground text-sm">
              One server didn&apos;t answer, or the history is long, so this may not show everything.
            </p>
          ) : null}
          {view.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <ul className="divide-y">
              {view.rows.map((r) => (
                <li key={r.id} className="flex justify-between gap-4 py-2 text-sm">
                  <span>
                    {r.label}
                    {r.device ? <span className="text-muted-foreground font-mono text-xs"> · {r.device}</span> : null}
                  </span>
                  <span className="text-muted-foreground shrink-0">{formatMountain(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
