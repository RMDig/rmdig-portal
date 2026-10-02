import { env } from "../env";
import { PINNED_AGREEMENT } from "./pinned";
import { present, type PresentedAgreement } from "./present";
import type { PinnedAgreement } from "./types";

export * from "./present";

// The agreement the portal presents (docs/plans/31 §4). Server-only: callers
// are server components and server actions.

// E2E-only stand-in while nothing is pinned (docs/plans/31 §4). It is labelled
// as a test on its face so it can never pass for the real agreement, and it is
// reachable only with E2E_AGREEMENT_FIXTURE=1 against the mock AvServ.
export const E2E_FIXTURE_AGREEMENT: PinnedAgreement = {
  version: "e2e-fixture",
  text:
    "# TEST FIXTURE — not an agreement\n\n" +
    "This text exists only for the portal's automated end-to-end tests. It has no legal " +
    "effect and is never shown in production.\n\n" +
    "## Section one\n\nPlaceholder paragraph for the scroll-to-end check.\n\n" +
    "## Section two\n\nAnother placeholder paragraph.\n",
  assent: { text: "TEST FIXTURE: I agree to this test text." },
  attestations: [
    { id: "age_18_plus", text: "TEST FIXTURE: I am 18 or older.", required: true },
  ],
};

function fixtureSeamOn(): boolean {
  // Both flags, so a stray E2E_AGREEMENT_FIXTURE can never surface test text
  // against a real AvServ.
  return (
    env.E2E_AGREEMENT_FIXTURE === "1" && (env.AVSERV_BASE_URL ?? "").startsWith("mock://")
  );
}

/** The version this build presents, or null when AvServ has published none. */
export function presentedAgreement(): PresentedAgreement | null {
  if (PINNED_AGREEMENT) return present(PINNED_AGREEMENT);
  if (fixtureSeamOn()) return present(E2E_FIXTURE_AGREEMENT, true);
  return null;
}
