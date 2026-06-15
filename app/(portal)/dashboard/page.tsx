import Link from "next/link";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Dashboard — rmdig",
};

export default async function DashboardPage() {
  // Layout already redirects unauthenticated users; this is a typed re-read.
  const session = await auth();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">Signed in as {session?.user?.email}.</p>

      <Card>
        <CardHeader>
          <CardTitle>Search &amp; rescue organizations</CardTitle>
          <CardDescription>
            Run a SAR team? Register your organization and draw your service area so alerts can route
            to you. Applications are reviewed before approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/sar/new">Register a SAR organization</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
