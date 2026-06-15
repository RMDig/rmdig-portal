import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Admin — rmdig",
};

export default async function AdminPage() {
  // The portal layout gates auth; this gates the platform-role requirement.
  // Defense-in-depth: the nav hides the link for non-staff, but the route
  // enforces it too so a direct URL can't reach admin tools.
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in");
  }
  const roles = await getPlatformRoles(session.user.id);
  if (roles.length === 0) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground mt-1">Your platform roles: {roles.join(", ")}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SAR approvals</CardTitle>
          <CardDescription>
            Review pending search-and-rescue organization applications and approve, reject, or
            request changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/admin/sar-approvals">Open the approvals queue</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
