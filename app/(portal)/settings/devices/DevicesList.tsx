import type { LinkedDevice } from "@/lib/avserv/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { shortDeviceId } from "@/lib/format/device-id";
import { formatMountainDate } from "@/lib/format/time";

// Read-only presentation of the devices linked to the user's AvServ account
// (P-B3). Server component — no interactivity; unlink is intentionally NOT here
// (it needs a separate AvServ write endpoint and triggers doc 05's merge
// semantics; deferred). Empty and error states are passed in by the page.

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return formatMountainDate(date);
}

export function DevicesList({ devices }: { devices: LinkedDevice[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked devices</CardTitle>
        <CardDescription>
          Devices currently linked to your account. To link a new one, generate a code below
          and enter it in the AvAI app.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No devices are linked yet. Generate a link code below to add your first device.
          </p>
        ) : (
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {d.platform}
                    {d.appVersion ? (
                      <span className="text-muted-foreground font-normal"> · v{d.appVersion}</span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">{shortDeviceId(d.deviceId)}</p>
                </div>
                <div className="text-muted-foreground text-right text-xs">
                  <p>Last seen {formatDate(d.lastSeenAt)}</p>
                  <p>Linked {formatDate(d.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
