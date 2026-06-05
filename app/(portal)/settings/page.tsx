import { LinkDeviceCard } from "./LinkDeviceCard";

export const metadata = {
  title: "Settings — rmdig",
};

export default function SettingsPage() {
  // The portal layout already gates unauthenticated access; the action re-checks
  // the session before minting.
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <LinkDeviceCard />
    </div>
  );
}
