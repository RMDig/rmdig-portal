import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGNATION_NOTICE } from "@/lib/legal/sms-program-copy";

// rmdig.ai/sms is the opt-in evidence page the approved A2P campaign links. Its
// designation notice must be the filed sample 1, character for character
// (AvServ docs/a2p/approved-campaign-2026-07-28.md). A 411-char never-filed
// version shipped here once; this pins the filed one.

const FILED_SAMPLE_1 =
  "AvAI: John Doe added you as their emergency contact on AvAI, a backcountry safety app. If they miss a safety check-in, you'll get an alert with their last-known location. Reply YES to confirm (optional). Msg frequency varies. Msg & data rates apply. Reply STOP to opt out, HELP for info.";

describe("designation notice (filed sample 1)", () => {
  it("matches the approved campaign verbatim", () => {
    expect(DESIGNATION_NOTICE).toBe(FILED_SAMPLE_1);
  });

  it("is one 287-character GSM-7-safe line", () => {
    expect(DESIGNATION_NOTICE).toHaveLength(287);
    expect(DESIGNATION_NOTICE).not.toMatch(/[\r\n]/);
    expect(DESIGNATION_NOTICE).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("/sms page", () => {
  const src = readFileSync(join(process.cwd(), "app", "(public)", "sms", "page.tsx"), "utf8");

  it("renders the notice from the shared constant in both places", () => {
    expect(src.match(/\{DESIGNATION_NOTICE\}/g)).toHaveLength(2);
  });

  it("carries no trace of the never-filed long notice", () => {
    expect(src).not.toMatch(/relying on you/);
    expect(src).not.toMatch(/Message rates apply/);
  });
});
