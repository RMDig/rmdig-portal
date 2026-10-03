import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// /privacy must mirror AvApp's declarations (AvApp docs/plans/43 §1 and
// ios/Runner/PrivacyInfo.xcprivacy; CLAUDE.md §0). When the app's data
// practices change, these change in the same release.

const src = readFileSync(join(process.cwd(), "app", "(public)", "privacy", "page.tsx"), "utf8")
  .replace(/\s+/g, " ")
  .replace(/&apos;/g, "'");

const manifest = src.slice(src.indexOf("Apple privacy-manifest disclosures"), src.indexOf("<h2>Security"));

describe("/privacy Apple manifest paragraph (AvApp doc 43 §1)", () => {
  it("lists every declared type, linked and not linked", () => {
    for (const phrase of [
      "your name and email address",
      "the emergency contacts you type in",
      "precise and coarse location",
      "a device ID the app generates (not Apple's advertising or vendor identifier)",
      "return times and the Send Help note",
      "other diagnostic data",
      "Not linked to you: crash data",
      "The app does no tracking",
    ]) {
      expect(manifest).toContain(phrase);
    }
  });

  it("no longer declares photos, which stay on the phone", () => {
    expect(manifest).toContain("Photos are not declared because they stay on your phone");
    expect(manifest).not.toMatch(/coarse location, and photos/);
  });
});

describe("/privacy captures and contributions", () => {
  it("has no unconditional capture-metadata retention row", () => {
    expect(src).not.toContain("Capture metadata (time, location, notes)</td> <td>Until you delete your account");
    expect(src).toContain("Submitted photos and labels (only if you choose to submit them)");
  });

  it("describes submitting conditionally, says payment details will be collected, and marks it for counsel", () => {
    expect(src).toContain("If you choose to submit them");
    expect(src).toContain("CC&nbsp;BY&nbsp;4.0");
    expect(src).toContain("collecting the details needed to pay you");
    expect(src).toMatch(/\[COUNSEL\] Final submission wording/);
  });
});

describe("/privacy open counsel items", () => {
  it("flags the under-13 vs 18+ conflict without picking an age", () => {
    expect(src).toMatch(/\[COUNSEL\] Reconcile the minimum age/);
  });

  it("keeps Incident Detection conditional on availability", () => {
    expect(src).toContain("When Incident Detection is available");
  });
});
