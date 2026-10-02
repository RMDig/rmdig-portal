// SMS program copy shown on rmdig.ai/sms, the opt-in evidence page linked from
// the approved A2P 10DLC campaign. Source of truth: the campaign as Twilio
// holds it, recorded verbatim on AvServ main under docs/a2p/. The Incident
// Detection re-filing (AvServ plan 38a) was approved 2026-10; its texts come
// from the submitted packet (plan 38a §4) and AvServ's message builders, and
// must match AvServ's read-back record of the approved campaign before this
// ships. When the record changes, this file changes in the same release; never
// paraphrase at a call site. tests/unit/sms-program-copy.test.ts pins every
// string here.

/**
 * Sample 1, the designation notice, verbatim as filed (also the campaign's
 * opt-in message). One line, 319 characters (the opt-in field's limit is 320).
 * AvServ's dispatch.IntroBody sends exactly this text from the same release.
 */
export const DESIGNATION_NOTICE =
  "AvAI: John Doe added you as their emergency contact on AvAI, a backcountry safety app. " +
  "If they miss a check-in or their phone reports a possible accident, we'll alert you with " +
  "their last-known location. Reply YES to confirm (optional). Msg frequency varies. " +
  "Msg & data rates apply. Reply STOP to opt out, HELP for info.";

export interface ProgramMessage {
  /** Short name shown above the quote. */
  label: string;
  /** When it is sent, in the contact's terms. */
  when: string;
  text: string;
}

const LOC_NOW = "Last known location: 39.61516, -106.14364 (+/-8 m).";

/** The automatic accident alert, filed sample 3 (AvServ IncidentAlertBody,
 *  server-deadline source). */
export const AUTOMATIC_ACCIDENT_ALERT =
  "AvAI automatic alert for John Doe: their phone reported a hard impact about 4 min ago and " +
  "we have not heard back from it since. This may be a false alarm, but treat it as real until " +
  `you reach them. ${LOC_NOW} Phone reported it 4 min ago. Call them now. If you cannot reach ` +
  "them, call 911, say this is an automatic phone alert that may be a false alarm, and give " +
  "this location.";

/** Prefix AvServ puts on every TEST DRILL message (incident.go drillBodyPrefix). */
export const TEST_DRILL_PREFIX = "AvAI TEST DRILL - no action needed. ";

/**
 * Every message the program sends, word for word, with the example values the
 * filing uses (John Doe; 39.61516, -106.14364). Filed samples 2-5 are quoted
 * from the approved campaign; the rest are covered by its description and are
 * the exact output of AvServ's builders (internal/dispatch, golden tests) or,
 * for the trip notice, account contract §3.9.
 */
export const PROGRAM_MESSAGES: ProgramMessage[] = [
  {
    label: "Trip notice (optional)",
    when: "When the user chooses to tell you they're heading out, with their planned return time.",
    text:
      "AvAI: John Doe is heading out and plans to be back by 5:00 PM MDT. We will text you again " +
      "only if they miss their check-in. Reply STOP to opt out.",
  },
  {
    label: "Missed check-in",
    when: "The user didn't check in by the time they set.",
    text:
      "AvAI safety alert: John Doe has not checked in by their expected return time. Please try to " +
      "reach them now. Last known location: 39.61516, -106.14364. Call them directly or check the " +
      "dashboard at avai.rmdig.ai. Treat this as real until you reach them.",
  },
  {
    label: "Automatic accident alert",
    when:
      "During an outing with Incident Detection on, the phone reported a possible accident and the user didn't respond.",
    text: AUTOMATIC_ACCIDENT_ALERT,
  },
  {
    label: "Accident reported",
    when: "The user reported an accident on their phone and asked AvAI to alert you.",
    text:
      `AvAI: John Doe reported an accident and asked AvAI to alert you. ${LOC_NOW} Phone reported ` +
      "it 1 min ago. Call them now. If you cannot reach them, call 911 and give this location.",
  },
  {
    label: "Accident reported, then no response",
    when: "The user reported an accident and then stopped responding.",
    text:
      "AvAI: John Doe reported an accident on their phone about 3 min ago and has not responded " +
      `since. ${LOC_NOW} Phone reported it 3 min ago. Call them now. If you cannot reach them, ` +
      "call 911 and give this location.",
  },
  {
    label: "Send Help",
    when: "The user pressed Send Help.",
    text:
      "AvAI EMERGENCY: John Doe has triggered Send Help. Please try to reach them now and consider " +
      "contacting local emergency services. Last known location: 39.61516, -106.14364. Call them " +
      "directly or check the dashboard at avai.rmdig.ai. Treat this as real until you reach them.",
  },
  {
    label: "Follow-up: false alarm",
    when: "After an accident alert, the user responded that it was a false alarm.",
    text:
      "AvAI: John Doe responded to the earlier alert and reports it was a false alarm. No further " +
      "action is needed.",
  },
  {
    label: "Follow-up: accident, no assistance needed",
    when: "After an accident alert, the user responded that they had an accident but don't need help now.",
    text:
      "AvAI: John Doe responded to the earlier alert. They report they had an accident but do not " +
      "need assistance now. You may still want to check on them.",
  },
  {
    label: "All-clear",
    when: "The user checked in safe.",
    text:
      "AvAI: John Doe has marked themselves safe. No further action is needed. Thank you. Reply STOP " +
      "to opt out of future alerts.",
  },
  {
    label: "Duplicate notice (missed check-in)",
    when: "Our servers may have sent the same missed check-in alert more than once.",
    text:
      "AvAI: our system may have sent you more than one alert about John Doe. Please treat the first " +
      "as the real notification and keep trying to reach them. No additional action is needed on " +
      "the duplicates.",
  },
  {
    label: "Duplicate notice (accident)",
    when: "Our servers may have sent more than one accident alert for the same event.",
    text:
      "AvAI: our system may have sent you more than one alert about John Doe for the same event. " +
      "It is one event, not several. Treat it as real until you reach them.",
  },
  {
    label: "TEST DRILL",
    when: "A labelled test of the alert system. No action is needed.",
    text: TEST_DRILL_PREFIX + AUTOMATIC_ACCIDENT_ALERT,
  },
];

/**
 * The in-app consent disclosure shown next to the Add Contact checkbox, twin of
 * AvApp lib/copy/compliance_copy.dart kContactSmsDisclosure (AvServ account
 * contract §3.8). The /sms screenshot shows it; this copy is the screenshot's
 * alt text, so a wording change there means a new screenshot and this string
 * in the same release.
 */
export const CONTACT_SMS_DISCLOSURE =
  "They'll get safety texts from AvAI about missed check-ins and emergencies. " +
  "Msg frequency varies. Msg & data rates may apply. They can reply STOP to opt out.";

/** The Add Contact checkbox label, twin of AvApp kContactPermissionAttestation. */
export const CONTACT_PERMISSION_ATTESTATION =
  "I confirm I have this person's permission to be added as an emergency contact " +
  "and alerted if I miss a check-in.";

/**
 * The live HELP auto-reply (Twilio Advanced Opt-Out on the sending number;
 * AvServ plan 22 §2 pin), confirmed by texting HELP on 2026-09-30. The campaign
 * record's registered help message is shorter ("Reply STOP to unsubscribe.
 * Msg&Data Rates May Apply."); the page shows what a contact actually receives.
 */
export const HELP_REPLY =
  "AvAI backcountry safety alerts by Rocky Mountain Digerati. This number messages you only " +
  "if an AvAI user listed you as their emergency contact, and only about their safety. " +
  "Msg frequency varies. Msg rates apply. Support: support@rmdig.ai or rmdig.ai. " +
  "Reply STOP to opt out.";

/** The YES confirmation AvServ's inbound webhook sends (dispatch.ConfirmBody),
 *  confirmed live on 2026-09-30. */
export const YES_CONFIRMATION =
  "AvAI: Confirmed. You are set as an emergency contact and will receive safety alerts " +
  "if needed. Reply STOP any time to opt out, HELP for help.";

/** The STOP auto-reply, as the re-filed campaign registers it (AvServ plan
 *  38a §4). Ships with the coordinated cutover, like DESIGNATION_NOTICE. */
export const STOP_REPLY =
  "AvAI: You are unsubscribed and will receive no more messages, including safety alerts. " +
  "Reply START to resubscribe.";
