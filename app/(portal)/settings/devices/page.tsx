import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DevicesList } from "./DevicesList";
import { auth } from "@/lib/auth";
import { listDevices, type LinkedDevice } from "@/lib/avserv/client";
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
    redirect("/sign-in");
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
  let devices: LinkedDevice[] | null = null;
  try {
    devices = await listDevices(user.avservAccountId);
  } catch (err) {
    // No silent catch (§5): log the cause; null drives the recoverable error UI.
    logger.error({ event: "avserv.devices.list_failed", userId: session.user.id, err });
  }

  return (
    <div className="space-y-6">
      <Header />
      {devices ? (
        <DevicesList devices={devices} />
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
      <LinkDeviceCard />
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
