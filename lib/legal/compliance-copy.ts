// Single source of truth for the portal's public-facing compliance / honesty
// copy. Mirrors AvApp's lib/copy/compliance_copy.dart (AvApp doc 02 P0-13/14,
// doc 16 §6.1/§6.2, doc 22 §3.3/§3.5): these strings are load-bearing
// safety-claim text — they bound what the public web surfaces are allowed to
// claim while AvAI is a TestFlight beta. Edit wording HERE and in the AvApp
// twin together; never inline a paraphrase at a call site.

/**
 * Operator-continuity honesty patch — AvApp doc 16 §6.1 permitted
 * public-release language, reproduced VERBATIM from AvApp
 * lib/copy/compliance_copy.dart `kOperatorContinuityDisclosure`. Must be the
 * FIRST paragraph of the support page (AvApp doc 02 P0-13). The "Always carry"
 * sentence is part of the permitted block — the §6.2 forbidden-phrase scan
 * exempts this exact string (see tests/unit/legal-copy.test.ts).
 */
export const OPERATOR_CONTINUITY_DISCLOSURE =
  "AvAI is a safety companion app. When you schedule a check-in, AvAI's " +
  "servers will alert your emergency contact if you don't check in on time. " +
  "The servers run in multiple locations to keep working when one fails, but " +
  "AvAI is operated by a small team and may have outages of hours or days. " +
  "Use AvAI as one layer of your safety practice, not your only layer. Always " +
  "carry a second safety plan — partner check-ins, satellite messenger (SPOT, " +
  "Garmin inReach), filed trip plan, formal training.";

/**
 * Beta-channel disclosure — verbatim twin of AvApp `kBetaModalBody` (doc 22
 * §3.3 #1). Surfaced anywhere the web describes the current AvAI channel.
 */
export const BETA_DISCLOSURE =
  "AvAI is in beta. Do not rely on it as your only safety system. The " +
  "check-out/check-in feature is being tested for reliability — bring a " +
  "satellite communicator or radio for any backcountry trip.";

/** Legal entity that operates AvAI, rmdig.ai, and the portal. */
export const LEGAL_ENTITY = "Rocky Mountain Digerati LLC";

/**
 * Public contact mailbox for support + privacy requests. NOTE (operator): this
 * alias must actually exist (Cloudflare Email Routing → operator inbox) before
 * the store listings go live — a dead contact path is a review rejection.
 */
export const SUPPORT_EMAIL = "support@rmdig.ai";

/**
 * AvApp doc 16 §6.2 — phrases forbidden in ANY public-facing surface at the
 * current rung. Enforced by tests/unit/legal-copy.test.ts over the public
 * pages and this module. "redundant" is forbidden unqualified; the permitted
 * §6.1 block above is exempted verbatim before scanning (it contains
 * "Always carry…", which is required copy, not a claim).
 */
export const FORBIDDEN_PUBLIC_PHRASES = [
  "always",
  "guaranteed",
  "real-time",
  "24/7",
  "never miss",
  "fail-safe",
  "redundant",
  "professional monitoring center",
  "fully staffed",
] as const;
