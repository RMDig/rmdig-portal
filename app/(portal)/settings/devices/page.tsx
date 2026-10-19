import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import Link from "next/link";

import { DevicesList } from "./DevicesList";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { deviceRevokeAvailable, listDevicesEveryNode } from "@/lib/avserv/device-revoke";
import type { MergedDevices } from "@/lib/avserv/device-revoke-merge";
import { isAvServOutage } from "@/lib/avserv/request";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { LinkDeviceCard } from "../LinkDeviceCard";

export const metadata = {
  title: "Devices — rmdig",
};

export default async function DevicesPage() {
  // The portal layout gates auth; re-read for the typed id and the account map.
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }

  const [user] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  // The login-time map (P-B1) hasn't populated this yet — usually a transient
  // AvServ hiccup at the last sign-in. Mirror LinkDeviceCard's guidance.
  if (!user?.avservAccountId) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Linked devices</CardTitle>
            <CardDescription>
              Your account isn&apos;t linked to the device service yet. Sign out and back in, then
              return here.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Keep the try/catch to data-fetching only; build JSX after (a thrown render
  // wouldn't be caught here anyway — see the react-hooks/error-boundaries rule).
  let devices: MergedDevices | null = null;
  try {
    // Every node, merged: a phone is signed out if any node says so (rev 1.1).
    devices = await listDevicesEveryNode(user.avservAccountId);
  } catch (err) {
    // No silent catch (§5): null drives the recoverable error UI. An AvServ
    // outage is logged; anything else (a portal bug, a contract drift, a
    // signing key problem) is a fault every user hits, so it also goes to Sentry.
    if (isAvServOutage(err)) {
      logger.warn({ event: "avserv.devices.list_unavailable", userId: session.user.id, err });
    } else {
      logger.error({ event: "avserv.devices.list_failed", userId: session.user.id, err });
      Sentry.captureException(err, { tags: { event: "avserv.devices.list_failed" } });
    }
  }

  return (
    <div className="space-y-6">
      <Header />
      {devices ? (
        <DevicesList devices={devices.devices} incomplete={devices.incomplete} revokeAvailable={deviceRevokeAvailable()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Linked devices</CardTitle>
            <CardDescription>
              We couldn&apos;t load your linked devices right now. Refresh in a moment — you can
              still generate a link code below.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      <LinkDeviceCard
        devices={devices?.devices.map((d) => ({ deviceId: d.deviceId, platform: d.platform })) ?? null}
      />
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
      <p className="text-muted-foreground text-sm">
        <Link href="/settings" className="hover:text-foreground underline">
          Settings
        </Link>{" "}
        / Devices
      </p>
    </div>
  );
}
