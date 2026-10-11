import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTACT_PERMISSION_ATTESTATION,
  CONTACT_SMS_DISCLOSURE,
  DESIGNATION_NOTICE,
  HELP_REPLY,
  YES_CONFIRMATION,
} from "@/lib/legal/sms-program-copy";

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

describe("auto-replies as a contact receives them (confirmed live 2026-09-30)", () => {
  it("HELP is the plan 22 §2 pin configured in Twilio Advanced Opt-Out", () => {
    expect(HELP_REPLY).toBe(
      "AvAI backcountry safety alerts by Rocky Mountain Digerati. This number messages you only if an AvAI user listed you as their emergency contact, and only about their safety. Msg frequency varies. Msg rates apply. Support: support@rmdig.ai or rmdig.ai. Reply STOP to opt out.",
    );
  });

  it("YES is AvServ dispatch.ConfirmBody", () => {
    expect(YES_CONFIRMATION).toBe(
      "AvAI: Confirmed. You are set as an emergency contact and will receive safety alerts if needed. Reply STOP any time to opt out, HELP for help.",
    );
  });

  it.each([HELP_REPLY, YES_CONFIRMATION])("is GSM-7-safe ASCII on one line: %s", (text) => {
    expect(text).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe("Add Contact consent copy (AvApp compliance_copy.dart twins, contract §3.8)", () => {
  it("matches the app's checkbox label and disclosure line", () => {
    expect(CONTACT_PERMISSION_ATTESTATION).toBe(
      "I confirm I have this person's permission to add them as my emergency contact, and for AvAI to text them about my trips and if I may need help.",
    );
    expect(CONTACT_SMS_DISCLOSURE).toBe(
      "They'll get texts from AvAI about your trips, missed check-ins and emergencies. Msg frequency varies. Msg & data rates may apply. They can reply STOP to opt out.",
    );
  });

  it("the disclosure states the elements the campaign's message flow names, and no automatic alerts", () => {
    expect(CONTACT_SMS_DISCLOSURE).toMatch(/your trips, missed check-ins and emergencies/);
    // No live campaign covers automatic accident alerts yet (restored only
    // with the Incident Detection cutover, plan 38a, in both twins).
    expect(CONTACT_SMS_DISCLOSURE).not.toMatch(/automatic|accident/i);
    expect(CONTACT_SMS_DISCLOSURE).toMatch(/Msg frequency varies/);
    expect(CONTACT_SMS_DISCLOSURE).toMatch(/Msg & data rates may apply/);
    expect(CONTACT_SMS_DISCLOSURE).toMatch(/reply STOP/);
  });
});

describe("/sms consent screenshot", () => {
  // AvApp main docs/screenshots/add_contact_attestation.png at 7b89e7a (box
  // unticked, Save disabled, the narrowed disclosure: trips, missed check-ins
  // and emergencies). A new app screenshot updates this hash and the consent
  // strings together.
  const APPROVED_SHA256 = "7749f895e46b35ebe153e936bda136443fb111d2726933f7f6f69275f6f0b999";
  // Earlier screenshots: without the disclosure line, with the
  // missed-check-ins-only disclosure, then naming automatic accident alerts
  // (987465e), which no live campaign covered.
  const SUPERSEDED_SHA256 = [
    "41457e9b5f5cddcfc923af115fae973763b6c459b85bb10bd34914cd50745169",
    "d93905399e7ca80a466e6a7918e2023da6728f47b9639f7e3d42acf4079dbb48",
    "9beb72cc9fb5a409f9247233fa236f8cf440f44583a2592ca699b1172db4e772",
  ];

  it("is the current AvApp screenshot with the disclosure line", () => {
    const bytes = readFileSync(join(process.cwd(), "public", "research", "designation-attestation.png"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(SUPERSEDED_SHA256).not.toContain(hash);
    expect(hash).toBe(APPROVED_SHA256);
  });
});

describe("/sms page", () => {
  const src = readFileSync(join(process.cwd(), "app", "(public)", "sms", "page.tsx"), "utf8");

  it("renders the notice from the shared constant in both places", () => {
    expect(src.match(/\{DESIGNATION_NOTICE\}/g)).toHaveLength(2);
  });

  it("quotes the consent disclosure from the shared constant, never a paraphrase", () => {
    expect(src).toMatch(/&ldquo;\{CONTACT_SMS_DISCLOSURE\}&rdquo;/);
    expect(src).not.toMatch(/safety texts about missed check-ins/);
  });

  it("renders HELP and YES from the shared constants, with no stale HELP text", () => {
    expect(src).toMatch(/\{HELP_REPLY\}/);
    expect(src).toMatch(/\{YES_CONFIRMATION\}/);
    expect(src).not.toMatch(/Privacy and details/);
  });

  it("shows the consent screen only as a captioned screenshot, never a live checkbox", () => {
    expect(src).not.toMatch(/type="checkbox"/);
    expect(src).toMatch(/Screenshot of the in-app Add Contact screen/);
  });

  it("carries no trace of the never-filed long notice", () => {
    expect(src).not.toMatch(/relying on you/);
    expect(src).not.toMatch(/Message rates apply/);
  });
});
