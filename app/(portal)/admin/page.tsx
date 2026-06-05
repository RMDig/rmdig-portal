import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles } from "@/lib/auth/roles";

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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="text-muted-foreground">
        Your platform roles: {roles.join(", ")}. SAR-org approvals and operator tools land in
        P1.4.
      </p>
    </div>
  );
}
