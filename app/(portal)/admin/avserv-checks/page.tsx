import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { hasPlatformRole } from "@/lib/auth/roles";
import { PROBE_EMAIL } from "@/lib/avserv/checks";

import { ChecksRunner } from "./ChecksRunner";

export const metadata = { title: "AvServ checks — rmdig admin" };

// rmdig admins: prove every AvServ node has the routes the portal uses and
// that our service key holds each route group (lib/avserv/checks.ts). Run it
// after a node release or a key change, and before a drill.
export default async function AvServChecksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AvServ checks</h1>
        <p className="text-muted-foreground mt-1">
          One harmless call per feature to each AvAI server, through the portal&apos;s own client code. The ids are
          made up, so nothing is written; the email lookup checks {PROBE_EMAIL} and AvServ records only a hash of it,
          with you as the reader.
        </p>
      </div>
      <ChecksRunner />
    </div>
  );
}
