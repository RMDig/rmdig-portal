import { formatMountain, SEVERITY_LABEL, type Severity } from "@/lib/announcements/announcements";

// One staff announcement as a full-width bar under the portal header. Used by
// the portal layout and by the admin preview, so staff see exactly what each
// audience sees.
const STYLE: Record<Severity, string> = {
  info: "bg-sky-50 text-sky-900 dark:bg-sky-900/20 dark:text-sky-200",
  maintenance: "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200",
  incident: "bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200",
};

export function AnnouncementBanner({
  message,
  severity,
  endsAt,
}: {
  message: string;
  severity: Severity;
  endsAt: Date | null;
}) {
  return (
    <div role={severity === "incident" ? "alert" : "status"} className={`border-b ${STYLE[severity]}`}>
      <div className="mx-auto max-w-5xl px-4 py-2 text-sm">
        <span className="font-medium">{SEVERITY_LABEL[severity]}:</span> {message}
        {endsAt ? <span className="opacity-80"> (until {formatMountain(endsAt)})</span> : null}
      </div>
    </div>
  );
}
