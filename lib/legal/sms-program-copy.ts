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
