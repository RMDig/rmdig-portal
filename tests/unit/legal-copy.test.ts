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

// The public-facing source files under scan: every route in the (public)
// group plus the deletion email templates (emails are public-facing too).
function publicSourceFiles(): string[] {
  const roots = [join(process.cwd(), "app", "(public)")];
  const files: string[] = [];
  while (roots.length > 0) {
    const dir = roots.pop();
    if (!dir) break;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) roots.push(full);
      else if (full.endsWith(".tsx")) files.push(full);
    }
  }
  // Error and not-found pages render for public visitors too.
  files.push(join(process.cwd(), "app", "error.tsx"), join(process.cwd(), "app", "not-found.tsx"));
  const templates = join(process.cwd(), "lib", "email", "templates");
  for (const entry of readdirSync(templates)) {
    if (entry.startsWith("DataDeletion")) files.push(join(templates, entry));
  }
  // AvAI onboarding (docs/plans/31 §4): the portal's own copy around the user
  // agreement. The pinned agreement text and wording (lib/agreement/pinned.ts)
  // are counsel's, fixed by AvServ's hashes, and deliberately not scanned.
  const settings = join(process.cwd(), "app", "(portal)", "settings");
  const agreementDir = join(settings, "agreement");
  for (const entry of readdirSync(agreementDir)) {
    if (entry.endsWith(".tsx")) files.push(join(agreementDir, entry));
  }
  // Restriction review (docs/plans/32): the user-facing page and the email.
  const review = join(process.cwd(), "app", "(portal)", "account", "review");
  for (const entry of readdirSync(review)) {
    if (entry.endsWith(".tsx")) files.push(join(review, entry));
  }
  files.push(join(templates, "RestrictionReviewUpheldEmail.tsx"));
  files.push(
    join(settings, "AvaiAccountCard.tsx"),
    join(settings, "AvaiIdentityForm.tsx"),
    join(process.cwd(), "lib", "agreement", "errors.ts"),
    join(process.cwd(), "lib", "agreement", "index.ts"),
  );
  return files;
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
