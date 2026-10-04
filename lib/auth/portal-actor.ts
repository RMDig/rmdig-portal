import { auth } from "@/lib/auth";
import { userMfaGate } from "@/lib/auth/mfa-gate";

export type PortalActor = { ok: true; userId: string } | { ok: false; error: string };

// The signed-in user a portal server action acts for. Server actions never pass
// through the portal layout, so this repeats its MFA gate: a user who must
// enroll can't act until they have (the enrollment actions themselves are
// exempt and call auth() directly).
export async function portalActor(): Promise<PortalActor> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if ((await userMfaGate(userId)).gate === "required") {
    return { ok: false, error: "Set up two-factor authentication first." };
  }
  return { ok: true, userId };
}
