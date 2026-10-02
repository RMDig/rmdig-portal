import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Carrier (A2P 10DLC) vetting reads /privacy and /terms; AvServ plan 38a §0
// lists what each must say. These statements must not drift off the pages.

const read = (page: string) =>
  readFileSync(join(process.cwd(), "app", "(public)", page, "page.tsx"), "utf8").replace(/\s+/g, " ");

const MESSAGE_TYPES = [
  /trip notice/i,
  /missed check-in alerts/i,
  /Send&nbsp;Help alerts/,
  /automatic accident alerts/i,
  /all-clear, false-alarm, and duplicate-alert follow-ups/i,
  /TEST DRILL/,
];

describe("/privacy SMS disclosures", () => {
  const src = read("privacy");

  it("keeps the CTIA non-sharing sentence verbatim", () => {
    expect(src).toContain(
      "No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.",
    );
  });

  it.each(MESSAGE_TYPES)("lists the message type %s", (re) => {
    expect(src).toMatch(re);
  });

  it("says what the phone sends for Incident Detection", () => {
    expect(src).toMatch(/motion summary and its location at the moment of a possible accident/);
  });
});

describe("/terms §6 SMS program terms", () => {
  const src = read("terms");

  it.each(MESSAGE_TYPES)("lists the message type %s", (re) => {
    expect(src).toMatch(re);
  });

  it("carries the carrier-liability line and a support contact", () => {
    expect(src).toContain("Carriers are not liable for delayed or undelivered messages.");
    expect(src).toMatch(/Support:.*SUPPORT_EMAIL/);
  });

  it("states frequency, rates, STOP and HELP", () => {
    expect(src).toMatch(/Message frequency varies/);
    expect(src).toMatch(/message and data rates may apply/i);
    expect(src).toMatch(/reply STOP/i);
    expect(src).toMatch(/HELP for program information/);
  });
});
