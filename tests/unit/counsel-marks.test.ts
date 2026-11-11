import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/lib/sar/terms-rules";

// Every team-facing string is counsel's to review before the first real team
// (plan 33 §6.9 F3): the alert, status and terms-decision emails, and
// onboarding. Each file carries a [COUNSEL] marking, so a change to it is
// seen as one counsel must see too. Add a new team-facing file here.

const TEAM_FACING = [
  // Emails to a team's members or admins.
  "lib/email/templates/SarAlertNotifyEmail.tsx",
  "lib/email/templates/SarTeamStatusEmail.tsx",
  "lib/email/templates/SarTermsDecisionEmail.tsx",
  "lib/email/templates/SarOrgDecisionEmail.tsx",
  "lib/email/templates/SarOrgSubmittedEmail.tsx",
  "lib/email/templates/PatrolReverifyTeamEmail.tsx",
  "lib/email/templates/OrgInviteEmail.tsx",
  "lib/email/templates/OncallEmailConfirmEmail.tsx",
  "lib/email/templates/SarTeamRecoveryEmail.tsx",
  "lib/sar/recovery-rules.ts",
  "app/(portal)/sar/[orgId]/layout.tsx",
  // Onboarding: applying, waiting for review, and the terms' services.
  "app/(portal)/sar/new/page.tsx",
  "app/(portal)/sar/new/SarOrgForm.tsx",
  "app/(portal)/sar/SarOrgFields.tsx",
  "app/(portal)/sar/pending/page.tsx",
  "lib/sar/terms-rules.ts",
  "lib/sar/oncall-email.ts",
  "components/sar/TermsView.tsx",
];

describe("[COUNSEL] markings (plan 33 §6.9 F3)", () => {
  it.each(TEAM_FACING)("%s is marked for counsel", (file) => {
    expect(readFileSync(join(process.cwd(), file), "utf8")).toContain("[COUNSEL]");
  });
});

describe("G3: named_to_contacts", () => {
  it("is labelled as the team's consent to be named, with its public number, in either case", () => {
    const c = CAPABILITIES.find((x) => x.name === "named_to_contacts")!;
    expect(c).toMatchObject({
      label: "Being named in a contact's alert, with your public number",
      note: "Whether or not your team was also sent the alert.",
      offered: true,
      message: false,
    });
  });
});
