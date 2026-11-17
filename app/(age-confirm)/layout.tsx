import { SiteFooter } from "@/components/nav/SiteFooter";
import { SiteHeader } from "@/components/nav/SiteHeader";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { navViewer } from "@/lib/nav/viewer";
import { SignOutButton } from "../(portal)/SignOutButton";

// The 18+ confirmation has its own layout, outside the portal one that
// redirects here, for the same reason as two-factor enrollment
// (app/(mfa-enroll)/layout.tsx): a page inside the redirecting layout is
// reached with that layout's redirect still in the browser.
export default async function AgeConfirmLayout({ children }: { children: React.ReactNode }) {
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
