import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { contactRow, contactsSummary } from "./contacts-view";
import { auth } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/auth/recent-auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { type Contact, listContacts } from "@/lib/avserv/contacts";
import { isAvServOutage } from "@/lib/avserv/request";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export const metadata = {
  title: "Emergency contacts — rmdig",
};

// The account's emergency contacts and which have replied YES (plan 05 P-B4,
// AvServ plan 63 A10). Read-only: contacts are added, removed and re-asked in
// the app. Who someone trusts as their emergency contact is as sensitive as
// their security history (plan 36 rule 1), so the page needs a recent login.
export default async function ContactsPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const userId = session.user.id;
  if (!(await requireRecentAuth(userId)).ok) {
    redirect(`/settings/reauth?returnTo=${encodeURIComponent("/settings/contacts")}`);
  }

  const [user] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.avservAccountId) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Emergency contacts</CardTitle>
            <CardDescription>
              Your account isn&apos;t linked to AvAI yet. Sign out and back in, then return here.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  let contacts: Contact[] | null = null;
  try {
    contacts = await listContacts(user.avservAccountId);
  } catch (err) {
    // null drives the "couldn't load" card. An outage is logged; anything else
    // (a 404 for a mapped account, a drifted contract, a signing fault) is a
    // bug every user would hit, so it also goes to Sentry. No contact data is
    // logged.
    if (isAvServOutage(err)) {
      logger.warn({ event: "avserv.contacts.list_unavailable", userId, err });
    } else {
      logger.error({ event: "avserv.contacts.list_failed", userId, err });
      Sentry.captureException(err, { tags: { event: "avserv.contacts.list_failed" } });
    }
  }

  if (!contacts) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Emergency contacts</CardTitle>
            <CardDescription>
              We couldn&apos;t load your emergency contacts right now. Refresh in a moment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const summary = contactsSummary(contacts);
  return (
    <div className="space-y-6">
      <Header />
      <Card>
        <CardHeader>
          <CardTitle>Emergency contacts</CardTitle>
          <CardDescription>
            A contact accepts by replying YES to the text AvAI sends them. AvAI is moving to
            require at least one accepted contact before you can check out. Add, remove or re-ask
            contacts in the AvAI app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className={summary.ready ? "text-sm font-medium" : "text-destructive text-sm font-medium"}>
            {summary.text}
          </p>
          {contacts.length > 0 ? (
            <ul className="divide-y">
              {contacts.map(contactRow).map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-muted-foreground text-xs">{r.reach}</p>
                    <p className="text-muted-foreground text-sm">{r.detail}</p>
                  </div>
                  <span className={r.accepted ? "text-sm font-medium" : "text-muted-foreground text-sm"}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">A YES can take a few seconds to show here.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Emergency contacts</h1>
      <p className="text-muted-foreground text-sm">
        <Link href="/settings" className="hover:text-foreground underline">
          Settings
        </Link>{" "}
        / Emergency contacts
      </p>
    </div>
  );
}
