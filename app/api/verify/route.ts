import { redirect } from "next/navigation";

export const runtime = "nodejs";

// Verification links sent before email-first sign-up (2026-10) point here.
// They now finish on the page where the password is chosen, so this only
// forwards the query string. It must not use the token up: mail scanners open
// links on delivery. Links live 24 hours, so this can go in the release after
// the one that ships email-first sign-up.
export async function GET(req: Request): Promise<Response> {
  const { search } = new URL(req.url);
  redirect(`/sign-up/finish${search}`);
}
