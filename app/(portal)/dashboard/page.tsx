import { auth } from "@/lib/auth";

export const metadata = {
  title: "Dashboard — rmdig",
};

export default async function DashboardPage() {
  // Layout already redirects unauthenticated users; this is a typed re-read.
  const session = await auth();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">
        Signed in as {session?.user?.email}. SAR org workspaces, device linking, and account
        settings land in the next P1.x milestones.
      </p>
    </div>
  );
}
