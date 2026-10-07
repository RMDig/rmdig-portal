import { desc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AUDIENCE_LABEL,
  AUDIENCES,
  audiencesOf,
  phaseOf,
  shownTo,
  type Audience,
  type Viewer,
} from "@/lib/announcements/announcements";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { announcements } from "@/lib/db/schema";

import { endAnnouncementAction } from "./actions";
import { AnnouncementForm } from "./AnnouncementForm";
import { formatMountain } from "@/lib/format/time";

export const metadata = { title: "Announcements — rmdig admin" };

// The viewer each preview stands for. Preview renders banners only: it loads
// no other person's data and changes no permissions.
const NONE: Viewer = { isStaff: false, isSar: false, isSarAdmin: false, isAdvertiser: false };
const PREVIEW_AS: Record<Audience, Viewer> = {
  everyone: NONE,
  explorer: NONE,
  // A SAR member who isn't an admin (dispatcher or responder).
  sar: { ...NONE, isSar: true },
  sar_admin: { ...NONE, isSar: true, isSarAdmin: true },
  advertiser: { ...NONE, isAdvertiser: true },
  staff: { ...NONE, isStaff: true },
};

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");

  const { preview } = await searchParams;
  const previewAs = AUDIENCES.find((a) => a === preview && a !== "everyone") ?? "explorer";

  const now = new Date();
  const rows = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(50);
  const withPhase = rows.map((r) => ({ ...r, phase: phaseOf(r, now) }));
  const live = withPhase.filter((r) => r.phase === "live");
  const scheduled = withPhase.filter((r) => r.phase === "scheduled");
  const past = withPhase.filter((r) => r.phase === "over").slice(0, 10);
  const previewViewer = audiencesOf(PREVIEW_AS[previewAs]);
  const previewed = live.filter((r) => shownTo(r, previewViewer));

  const describe = (r: (typeof withPhase)[number]) =>
    [
      r.audiences.map((a) => AUDIENCE_LABEL[a]).join(", "),
      r.startsAt ? `from ${formatMountain(r.startsAt)}` : null,
      r.endsAt ? `until ${formatMountain(r.endsAt)}` : "until ended",
      r.endedAt ? `ended ${formatMountain(r.endedAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const list = (items: typeof withPhase, canEnd: boolean) =>
    items.length === 0 ? (
      <p className="text-muted-foreground text-sm">None.</p>
    ) : (
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r.id} className="space-y-1">
            <div className="overflow-hidden rounded-md border">
              <AnnouncementBanner message={r.message} severity={r.severity} endsAt={r.endsAt} />
            </div>
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="text-muted-foreground">{describe(r)}</span>
              {canEnd ? (
                <form action={endAnnouncementAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" variant="outline" size="sm">
                    End now
                  </Button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="text-muted-foreground mt-1">
          Banners on signed-in portal pages. For taking the whole portal down, use the maintenance
          switch (runbook &quot;Portal maintenance switch&quot;).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>Public copy: no internal detail, none of the forbidden claims.</CardDescription>
        </CardHeader>
        <CardContent>
          <AnnouncementForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview as</CardTitle>
          <CardDescription>What a viewer in this audience sees right now. Shows banners only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-sm">
            {AUDIENCES.filter((a) => a !== "everyone").map((a) => (
              <Link
                key={a}
                href={`/admin/announcements?preview=${a}`}
                className={`rounded-md border px-3 py-1 ${a === previewAs ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : ""}`}
              >
                {AUDIENCE_LABEL[a]}
              </Link>
            ))}
          </div>
          <div className="overflow-hidden rounded-md border">
            {previewed.length === 0 ? (
              <p className="text-muted-foreground p-3 text-sm">No banners for {AUDIENCE_LABEL[previewAs].toLowerCase()} right now.</p>
            ) : (
              previewed.map((r) => (
                <AnnouncementBanner key={r.id} message={r.message} severity={r.severity} endsAt={r.endsAt} />
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live</CardTitle>
        </CardHeader>
        <CardContent>{list(live, true)}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Scheduled</CardTitle>
        </CardHeader>
        <CardContent>{list(scheduled, true)}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recently ended</CardTitle>
        </CardHeader>
        <CardContent>{list(past, false)}</CardContent>
      </Card>
    </div>
  );
}
