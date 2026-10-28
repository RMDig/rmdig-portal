import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// /privacy must mirror AvApp's ios/Runner/PrivacyInfo.xcprivacy and the Play
// Data Safety form (CLAUDE.md §0). AvApp's cross-check (2026-10-27) found the
// page declaring photos (never declared: they stay on the phone) and email as
// the contact's required detail (it's the phone number). Pin the corrections.

const src = readFileSync(join(process.cwd(), "app", "(public)", "privacy", "page.tsx"), "utf8")
  .replace(/&apos;/g, "'")
  .replace(/\s+/g, " ");

describe("/privacy matches the app's privacy manifest", () => {
  it("lists the declared data types, linked and not linked", () => {
    for (const type of [
      "your name and email address",
      "the emergency contacts you enter",
      "precise and coarse location",
      "a device ID the app generates",
      "other content you enter",
      "other diagnostic data",
      "Not linked to you: crash data",
    ]) {
      expect(src).toContain(type);
    }
  });

  it("never says photos are declared", () => {
    expect(src).toContain("Photos are not declared because they stay on your phone");
    expect(src).not.toMatch(/declares[^.]*\bphotos\b/i);
  });

  it("says the contact's phone number is required and email optional", () => {
    expect(src).toContain("a mobile phone number, required because alerts go by text, and optionally an email address");
  });
});
