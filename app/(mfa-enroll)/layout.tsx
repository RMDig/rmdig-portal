import { SiteFooter } from "@/components/nav/SiteFooter";
import { SiteHeader } from "@/components/nav/SiteHeader";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { navViewer } from "@/lib/nav/viewer";
import { SignOutButton } from "../(portal)/SignOutButton";

// Two-factor enrollment has its own layout, outside the portal one, because
// the portal layout redirects here when two-factor is required. Next reuses a
// layout across client navigations without rendering it again, so a page
// inside the redirecting layout was reached with that layout's redirect still
// in the browser: after sign-in (a server action that renders the dashboard)
// the browser fetched the enroll page without end and showed a blank page
// until reloaded (2026-11-13). Moving between layouts makes Next render the
// new one, so neither the redirect nor its exemption for this path is needed.
export default async function MfaEnrollLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const viewer = await navViewer(session.user.id, session.user.email ?? "");
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader viewer={viewer} signOut={<SignOutButton />} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
