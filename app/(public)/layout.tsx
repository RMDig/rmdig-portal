import { SiteFooter } from "@/components/nav/SiteFooter";
import { SiteHeader } from "@/components/nav/SiteHeader";

// Shared chrome for every no-auth public surface (landing, privacy, terms,
// support, data-deletion). These routes are store-submission gates (AvApp doc
// 24 §1.4): App Store Connect and Play Console fetch them with no session, so
// nothing under this group may import auth or gate on a user. Keep it static.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader viewer="probe" />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
