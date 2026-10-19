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
import { DeviceRevoke } from "./DeviceRevoke";
import { RevokeOthers } from "./RevokeOthers";
import { REVOKE_COPY } from "./revoke-copy";

// The phones linked to the user's AvServ account, merged from every node
// (P-B3; device_revoke.md rev 1.1 §3.6). A signed-out phone stays listed as
// signed out: there is no un-revoke, and a recovered phone links as a new one.

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return formatMountainDate(date);
}

const REASON = { lost: "lost", stolen: "stolen", user: "no longer used" } as const;

export function DevicesList({
  devices,
  incomplete,
  revokeAvailable,
}: {
  devices: LinkedDevice[];
  incomplete: boolean;
  revokeAvailable: boolean;
}) {
  const live = devices.filter((d) => !d.userRevokedAt);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Linked devices</CardTitle>
          <CardDescription>
            Devices linked to your account. To link a new one, generate a code below and enter it
            in the AvAI app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {incomplete ? (
            <p className="text-muted-foreground text-sm">
              One server didn&apos;t answer, so a phone may be missing here. Refresh in a moment.
            </p>
          ) : null}
          {devices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No devices are linked yet. Generate a link code below to add your first device.
            </p>
          ) : (
            <ul className="divide-y">
              {devices.map((d) => (
                <li key={d.deviceId} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {d.platform}
                      {d.appVersion ? (
                        <span className="text-muted-foreground font-normal"> · v{d.appVersion}</span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">{shortDeviceId(d.deviceId)}</p>
                    {d.userRevokedAt ? (
                      <p className="text-sm">
                        Signed out {formatDate(d.userRevokedAt)}
                        {d.revokeReason ? ` (${REASON[d.revokeReason]})` : ""}.{" "}
                        <span className="text-muted-foreground">
                          {d.revokeMode ? REVOKE_COPY.mode[d.revokeMode] : REVOKE_COPY.sendHelpStays}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground text-right text-xs">
                    <p>Last seen {formatDate(d.lastSeenAt)}</p>
                    <p>Linked {formatDate(d.createdAt)}</p>
                  </div>
                  {revokeAvailable ? <DeviceRevoke deviceId={d.deviceId} revoked={!!d.userRevokedAt} /> : null}
                </li>
              ))}
            </ul>
          )}
          {!revokeAvailable && live.length > 0 ? (
            <p className="text-muted-foreground text-sm">Signing a phone out from here isn&apos;t available yet.</p>
          ) : null}
        </CardContent>
      </Card>

      {revokeAvailable && live.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign out your other phones</CardTitle>
            <CardDescription>
              Choose the phone you&apos;re keeping, and every other phone on your account is signed out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RevokeOthers
              phones={live.map((d) => ({
                deviceId: d.deviceId,
                label: `${d.platform}${d.appVersion ? ` v${d.appVersion}` : ""} · ${shortDeviceId(d.deviceId)}`,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
