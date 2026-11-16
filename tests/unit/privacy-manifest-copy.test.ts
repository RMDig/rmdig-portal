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

  // AvApp doc 43 §1 (2026-11-02): the app has no contact email field yet, and
  // the portal's contacts page has none, so no contact email is held.
  it("says the contact's phone number is required, and claims no contact email", () => {
    expect(src).toContain("a mobile phone number, required because alerts go by text) of the emergency contact");
    expect(src).not.toMatch(/optionally an email address|phone number and\/or email|by SMS and email/);
  });

  // AvApp doc 43 §1 rows added after 2026-10-27 (plan 56 audit, 2026-11-15).
  it("discloses every doc 43 wire row the page used to miss", () => {
    expect(src).toMatch(/MapTiler, our map provider/);
    expect(src).toMatch(/MapTiler \(map tiles\)/);
    expect(src).toMatch(/Apple \(push notification delivery to iPhones\)/);
    expect(src).toContain("push tokens and your phone's time zone");
    expect(src).toContain("holds your legal name, your display name and your email address");
    expect(src).toContain("device, IP address, user agent, app version, platform (iOS or Android) and language");
  });

  it("keeps capture metadata on the phone, like the photos", () => {
    expect(src).toContain("<td>On your device only, with the photos it describes</td>");
  });
});
