import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The app requires 18+ (AvApp agreement_screen age_18_plus; doc 17 §3.14), so
// /terms and /privacy say so, in counsel's words from the HNDM v10.26.26 drafts.
// Counsel's final clauses still replace them: the [LAWYER] slots stay.

function page(name: "terms" | "privacy"): string {
  return readFileSync(join(process.cwd(), "app", "(public)", name, "page.tsx"), "utf8")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ");
}

describe("the 18+ rule on the public legal pages", () => {
  it("/terms §1 states counsel's minimum-age sentence above the acceptance placeholder", () => {
    const src = page("terms");
    const sentence =
      "By using our Services, you represent and warrant that you are at least 18 years of age with full legal capacity and authority to enter into these Terms of Service.";
    expect(src).toContain(sentence);
    const placeholder = src.indexOf("Binding acceptance clause");
    expect(placeholder).toBeGreaterThan(src.indexOf(sentence));
  });

  it("/privacy Children states counsel's under-18 clause and keeps its placeholder", () => {
    const src = page("privacy");
    expect(src).toContain(
      "AvAI and the rmdig portal are not directed to nor offered to children and young people under the age of 18, and we do not knowingly collect their data.",
    );
    expect(src).toContain("Our customers are required to represent to us that they are 18 years of age or older");
    expect(src).toContain("Final children's-privacy clause");
    expect(src).not.toMatch(/children under 13/);
  });
});
