import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BETA_DISCLOSURE,
  CONTRIBUTE_BODY,
  CONTRIBUTE_FORBIDDEN_PHRASES,
  FORBIDDEN_PUBLIC_PHRASES,
  OPERATOR_CONTINUITY_DISCLOSURE,
} from "@/lib/legal/compliance-copy";

// Safety-claim discipline for the public web surfaces — the portal half of
// AvApp doc 16 §6.2 ("CI-grep enforced once the public-facing-assets manifest
// exists"; these files ARE that manifest for the portal). The current rung is
// a TestFlight beta: copy must never claim above it.

// Verbatim pins against AvApp lib/copy/compliance_copy.dart. If these fail,
// someone edited one side of the twin — re-sync BOTH, never paraphrase.
const EXPECTED_DISCLOSURE =
  "AvAI is a safety companion app. When you schedule a check-in, AvAI's " +
  "servers will alert your emergency contact if you don't check in on time. " +
  "The servers run in multiple locations to keep working when one fails, but " +
  "AvAI is operated by a small team and may have outages of hours or days. " +
  "Use AvAI as one layer of your safety practice, not your only layer. Always " +
  "carry a second safety plan — partner check-ins, satellite messenger (SPOT, " +
  "Garmin inReach), filed trip plan, formal training.";

const EXPECTED_BETA =
  "AvAI is in beta. Do not rely on it as your only safety system. The " +
  "check-out/check-in feature is being tested for reliability — bring a " +
  "satellite communicator or radio for any backcountry trip.";

// Verbatim pin against AvApp lib/copy/contribute_copy.dart `kContributeBody`
// (doc 35 §5.1). Same twin rule as above.
const EXPECTED_CONTRIBUTE_BODY =
  "AvAI is free. Contributions go to Rocky Mountain Digerati LLC, the " +
  "company that runs AvAI, and pay for the servers and the check-in " +
  "watchdog. They are not tax-deductible, they unlock nothing in the app, " +
  "and no part of them goes to any search-and-rescue team.";

// One phrase-matcher for both lists: word-boundary prefix so "always-on"
// hits but a class name with "always" buried mid-word does not; the phrase
// itself is matched literally (so "501(c)" and "tax-deductible" work).
function forbiddenPattern(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i");
}

// Every file with one of `extensions` under `dir`, recursively.
function filesUnder(dir: string, extensions: string[]): string[] {
  const roots = [dir];
  const files: string[] = [];
  while (roots.length > 0) {
    const current = roots.pop();
    if (!current) break;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) roots.push(full);
      else if (extensions.some((ext) => full.endsWith(ext))) files.push(full);
    }
  }
  return files;
}

// The public-facing source files under scan: every route in the (public)
// group, every email template (emails are public-facing too), and the pages a
// signed-out visitor reaches from them: sign-in/sign-up/reset (with the action
// error strings they show) and the three invitation landings.
function publicSourceFiles(): string[] {
  const app = join(process.cwd(), "app");
  const files: string[] = [
    ...filesUnder(join(app, "(public)"), [".tsx"]),
    ...filesUnder(join(process.cwd(), "lib", "email", "templates"), [".tsx"]),
    ...filesUnder(join(app, "(auth)"), [".tsx", ".ts"]),
    ...filesUnder(join(app, "invite"), [".tsx", ".ts"]),
    ...filesUnder(join(app, "admin-invite"), [".tsx", ".ts"]),
    ...filesUnder(join(app, "advertiser-invite"), [".tsx", ".ts"]),
  ];
  // The signed-in map's page and panel (its legend strings are checked in
  // tests/unit/map-layers.test.ts).
  for (const f of ["page.tsx", "MapView.tsx", "MapLegend.tsx"]) files.push(join(process.cwd(), "app", "(portal)", "map", f));
  // SAR team terms: the editor's guidance and the shared view users' terms
  // render through (docs/plans/33).
  files.push(
    join(process.cwd(), "app", "(portal)", "sar", "[orgId]", "terms", "TermsEditor.tsx"),
    join(process.cwd(), "app", "(portal)", "sar", "[orgId]", "terms", "page.tsx"),
    join(process.cwd(), "components", "sar", "TermsView.tsx"),
    // The on-call email card and its words (plan 33 9.10).
    join(process.cwd(), "app", "(portal)", "sar", "[orgId]", "terms", "OncallEmailCard.tsx"),
    join(process.cwd(), "lib", "sar", "oncall-email.ts"),
    join(process.cwd(), "app", "(portal)", "sar", "[orgId]", "alerts", "page.tsx"),
    // The RED layer's labels, legend, notice and error text on /map.
    join(process.cwd(), "lib", "map", "red.ts"),
  );
  // The shared header and footer render on every public page; the dashboard
  // is seen by every new account.
  files.push(
    join(process.cwd(), "components", "nav", "SiteHeader.tsx"),
    join(process.cwd(), "components", "nav", "SiteFooter.tsx"),
    join(process.cwd(), "app", "(portal)", "dashboard", "page.tsx"),
  );
  // Error and not-found pages render for public visitors too.
  files.push(join(process.cwd(), "app", "error.tsx"), join(process.cwd(), "app", "not-found.tsx"));
  // AvAI onboarding (docs/plans/31 §4): the portal's own copy around the user
  // agreement. The pinned agreement text and wording (lib/agreement/pinned.ts)
  // are counsel's, fixed by AvServ's hashes, and deliberately not scanned.
  const settings = join(process.cwd(), "app", "(portal)", "settings");
  const agreementDir = join(settings, "agreement");
  for (const entry of readdirSync(agreementDir)) {
    if (entry.endsWith(".tsx")) files.push(join(agreementDir, entry));
  }
  // Restriction review (docs/plans/32): the user-facing page (its email is a template, above).
  const review = join(process.cwd(), "app", "(portal)", "account", "review");
  for (const entry of readdirSync(review)) {
    if (entry.endsWith(".tsx")) files.push(join(review, entry));
  }
  // Emergency contacts (AvServ plan 63 A10): says what accepting means for checking out.
  files.push(join(settings, "contacts", "page.tsx"), join(settings, "contacts", "contacts-view.ts"));
  files.push(
    join(settings, "AvaiAccountCard.tsx"),
    join(settings, "AvaiIdentityForm.tsx"),
    join(process.cwd(), "lib", "agreement", "errors.ts"),
    join(process.cwd(), "lib", "agreement", "index.ts"),
  );
  return [...new Set(files)];
}

describe("compliance copy pins", () => {
  it("operator-continuity disclosure matches AvApp verbatim", () => {
    expect(OPERATOR_CONTINUITY_DISCLOSURE).toBe(EXPECTED_DISCLOSURE);
  });

  it("beta disclosure matches AvApp verbatim", () => {
    expect(BETA_DISCLOSURE).toBe(EXPECTED_BETA);
  });

  it("contribute body matches AvApp verbatim", () => {
    expect(CONTRIBUTE_BODY).toBe(EXPECTED_CONTRIBUTE_BODY);
  });

  it("support page renders the disclosure as its first paragraph", () => {
    const src = readFileSync(
      join(process.cwd(), "app", "(public)", "support", "page.tsx"),
      "utf8",
    );
    // The first <p> after the h1 must be the verbatim constant — nothing may
    // render before it (AvApp doc 02 P0-13: "first paragraph").
    expect(src).toMatch(/<\/h1>\s*<p[^>]*>\{OPERATOR_CONTINUITY_DISCLOSURE\}<\/p>/);
  });

  // AvApp plan 61 rule 7: this section is live before build 1.0.0+8 ships.
  it("privacy page explains problem reports and how long they're kept", () => {
    const privacy = readFileSync(join(process.cwd(), "app/(public)/privacy/page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(privacy).toContain("Settings → Privacy → Report a problem");
    expect(privacy).toContain("never keep one longer than 30 days");
    expect(privacy).toContain("Anonymous or with your account:");
    // Twin of AvApp #436: anonymous reports can be linked by phone, never "unknown sender".
    expect(privacy).toContain(
      "Reports from one phone can overlap, so support could tell two came from the same phone, even if one was sent with your account.",
    );
    expect(privacy).not.toContain("without knowing who sent it");
    // Twin of AvApp #437.
    expect(privacy).toContain("a map from the report&apos;s stand-ins to the real identifiers");
    expect(privacy).not.toContain("two anonymous reports can&apos;t be connected");
    expect(privacy).toContain("<td>Problem reports</td>");
  });

  // Twin of AvApp #442: state the 15-minute ceiling and that the OS sets the
  // cadence while locked; never promise a steady interval.
  it("privacy page states how often a checked-out phone sends its location", () => {
    const privacy = readFileSync(join(process.cwd(), "app/(public)/privacy/page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(privacy).toContain(
      "While you&apos;re checked out, your phone sends its location to AvAI, up to every 15 minutes. While the phone is locked, iOS and Android decide when, sometimes an hour or more apart.",
    );
    expect(privacy).toContain("up to once an hour");
    expect(privacy).not.toMatch(/about every 15 minutes|regularly|periodic/i);
  });

  it("privacy page names both email providers", () => {
    // Resend sends the portal's email, Postmark AvServ's.
    const src = readFileSync(
      join(process.cwd(), "app", "(public)", "privacy", "page.tsx"),
      "utf8",
    );
    expect(src).toContain("Resend");
    expect(src).toContain("Postmark");
  });
});

// STOP ends texts, not alerts: AvServ keeps alerting by email when the trip
// holds the contact's address (findings 2026-11-01, rows 3.1-3.4). The account
// holder notice isn't built, so no page may say the user is told.
describe("STOP and phone sign-out copy", () => {
  const page = (path: string) =>
    readFileSync(join(process.cwd(), "app/(public)", path, "page.tsx"), "utf8").replace(/\s+/g, " ");

  it("says STOP ends text messages on every page that explains it", () => {
    expect(page("privacy")).toContain("text messages to your number end, for every user who named it");
    expect(page("terms")).toContain("for every user who named that number");
    expect(page("alerts")).toContain("for every AvAI user who named it");
  });

  it("makes no claim that STOP ends all alerts or that the user is told", () => {
    expect(page("privacy")).not.toMatch(/you will not receive that person/i);
    expect(page("terms")).not.toMatch(/stops receiving your alerts|and you are told/i);
    expect(page("alerts")).not.toMatch(/opts you out of all messages/i);
  });

  it("says a contact who stopped can be chosen again after START", () => {
    expect(page("terms")).toContain("can&apos;t be chosen for a new trip unless they reply START");
  });

  it("says a precise location goes with a check-out and Send Help", () => {
    expect(page("privacy")).toContain("a precise location also goes with your check-out and any Send&nbsp;Help");
  });

  it("doesn't call a phone revoke the end of the phone's session", () => {
    expect(page("privacy")).not.toContain("browsers or phones signed out");
  });

  it("doesn't describe avalanche detection on the research page", () => {
    expect(page("research/incident-detection")).not.toMatch(/caught in an avalanche|avalanche involvement/i);
  });
});

describe("forbidden-phrase scan (doc 16 §6.2)", () => {
  const files = publicSourceFiles();

  it("finds the public surfaces", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    // /contribute is a public claim surface too (doc 35 §5 is written to pass
    // this list); it must not drop out of the walk.
    expect(files.some((f) => f.endsWith(join("contribute", "page.tsx")))).toBe(true);
  });

  it("contribute body carries no forbidden claim", () => {
    for (const phrase of FORBIDDEN_PUBLIC_PHRASES) {
      expect(forbiddenPattern(phrase).test(CONTRIBUTE_BODY), `"${phrase}" in CONTRIBUTE_BODY`).toBe(
        false,
      );
    }
  });

  it("covers every email template and the auth and invitation pages", () => {
    const rel = files.map((f) => f.slice(process.cwd().length + 1));
    for (const template of readdirSync(join(process.cwd(), "lib", "email", "templates"))) {
      expect(rel).toContain(join("lib", "email", "templates", template));
    }
    for (const page of [
      join("app", "(auth)", "sign-in", "page.tsx"),
      join("app", "(auth)", "sign-up", "page.tsx"),
      join("app", "(auth)", "sign-up", "finish", "page.tsx"),
      join("app", "(auth)", "actions.ts"),
      join("app", "invite", "[token]", "page.tsx"),
      join("app", "admin-invite", "[token]", "page.tsx"),
      join("app", "advertiser-invite", "[token]", "page.tsx"),
    ]) {
      expect(rel).toContain(page);
    }
  });

  for (const file of files) {
    it(`no forbidden claims in ${file.slice(file.indexOf("rmdig-portal") + 13)}`, () => {
      const raw = readFileSync(file, "utf8");
      for (const phrase of FORBIDDEN_PUBLIC_PHRASES) {
        expect(
          forbiddenPattern(phrase).test(raw),
          `"${phrase}" found in ${file} — forbidden in public copy at the beta rung`,
        ).toBe(false);
      }
    });
  }
});

// AvApp doc 35 §3.5 — the contribution-surface ban list, SCOPED to /contribute
// only. Not folded into FORBIDDEN_PUBLIC_PHRASES on purpose: the SAR partner
// directory will later quote partner-supplied blurbs that may legitimately
// say "nonprofit" or "501(c)(3)".
describe("contribute-page scoped scan (doc 35 §3.5)", () => {
  const contributeDir = join(process.cwd(), "app", "(public)", "contribute");
  const files = readdirSync(contributeDir)
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => join(contributeDir, entry));

  it("finds the contribute surface", () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("the scoped list is exactly doc 35 §3.5 (as amended 2026-09-06) and disjoint from the global list", () => {
    expect([...CONTRIBUTE_FORBIDDEN_PHRASES]).toEqual([
      "donation",
      "donate",
      "charity",
      "charitable",
      "nonprofit",
      "non-profit",
      "tax-deductible",
      "501(c)",
    ]);
    for (const phrase of CONTRIBUTE_FORBIDDEN_PHRASES) {
      expect(FORBIDDEN_PUBLIC_PHRASES).not.toContain(phrase);
    }
  });

  it("contribute body uses a banned word only as the required negation", () => {
    // "not tax-deductible" IS the disclosure the ban protects (doc 35 §3.1) —
    // the one permitted use, exempted verbatim like the continuity block.
    // Anything else on the list, or a second "tax-deductible", fails.
    const exempted = CONTRIBUTE_BODY.replace("not tax-deductible", "");
    expect(CONTRIBUTE_BODY.match(/tax-deductible/g)).toHaveLength(1);
    for (const phrase of CONTRIBUTE_FORBIDDEN_PHRASES) {
      expect(forbiddenPattern(phrase).test(exempted), `"${phrase}" in CONTRIBUTE_BODY`).toBe(
        false,
      );
    }
  });

  for (const file of files) {
    it(`no contribution-surface banned words in ${file.slice(file.indexOf("rmdig-portal") + 13)}`, () => {
      const raw = readFileSync(file, "utf8");
      for (const phrase of CONTRIBUTE_FORBIDDEN_PHRASES) {
        expect(
          forbiddenPattern(phrase).test(raw),
          `"${phrase}" found in ${file} — banned on the contribution surface (doc 35 §3.5)`,
        ).toBe(false);
      }
    });
  }
});
