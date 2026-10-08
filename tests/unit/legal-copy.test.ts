import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BETA_DISCLOSURE,
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
  });

  it("covers every email template and the auth and invitation pages", () => {
    const rel = files.map((f) => f.slice(process.cwd().length + 1));
    for (const template of readdirSync(join(process.cwd(), "lib", "email", "templates"))) {
      expect(rel).toContain(join("lib", "email", "templates", template));
    }
    for (const page of [
      join("app", "(auth)", "sign-in", "page.tsx"),
      join("app", "(auth)", "sign-up", "page.tsx"),
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
        // "always" needs a word boundary ("always-on" should still hit, but
        // e.g. a class name containing "always" as a substring of another
        // word should not); multiword phrases match literally.
        const pattern = new RegExp(
          `\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`,
          "i",
        );
        expect(
          pattern.test(raw),
          `"${phrase}" found in ${file} — forbidden in public copy at the beta rung`,
        ).toBe(false);
      }
    });
  }
});
