// SMS program copy shown on rmdig.ai/sms, the opt-in evidence page linked from
// the approved A2P 10DLC campaign. Source of truth: the campaign as Twilio
// holds it, recorded verbatim on AvServ main at
// docs/a2p/approved-campaign-2026-07-28.md. When that record changes (a
// re-filing), this file changes in the same release; never paraphrase at a
// call site. tests/unit/sms-program-copy.test.ts pins every string here.

/**
 * Sample 1, the designation notice, verbatim as filed (also the campaign's
 * opt-in message). One line, 287 characters. AvServ's dispatch.IntroBody sends
 * exactly this text.
 */
export const DESIGNATION_NOTICE =
  "AvAI: John Doe added you as their emergency contact on AvAI, a backcountry safety app. " +
  "If they miss a safety check-in, you'll get an alert with their last-known location. " +
  "Reply YES to confirm (optional). Msg frequency varies. Msg & data rates apply. " +
  "Reply STOP to opt out, HELP for info.";

/**
 * The in-app consent disclosure shown next to the Add Contact checkbox, twin of
 * AvApp lib/copy/compliance_copy.dart kContactSmsDisclosure (AvServ account
 * contract §3.8). The /sms screenshot shows it; this copy is the screenshot's
 * alt text, so a wording change there means a new screenshot and this string
 * in the same release.
 */
// Narrowed 2026-10-07 (owner decision): "including automatic accident
// alerts" is removed because no live campaign covers automatic alerts yet.
// The wording is pending counsel. The clause comes back only with the
// Incident Detection campaign cutover (plan 38a), in both twins (this and
// AvApp kContactSmsDisclosure) and a new /sms screenshot, in the same release.
export const CONTACT_SMS_DISCLOSURE =
  "They'll get texts from AvAI about your trips, missed check-ins and emergencies. " +
  "Msg frequency varies. Msg & data rates may apply. They can reply STOP to opt out.";

/** The Add Contact checkbox label, twin of AvApp kContactPermissionAttestation. */
export const CONTACT_PERMISSION_ATTESTATION =
  "I confirm I have this person's permission to add them as my emergency contact, " +
  "and for AvAI to text them about my trips and if I may need help.";

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
