// What Settings → Devices says about signing a phone out. One place, so it
// stays in step with what the phone and AvServ actually do (AvApp plan 54
// §7.1a; AvServ device_revoke.md rev 2) and is scanned for claim words
// (tests/unit/device-revoke-copy.test.ts). Never promise more than the phone
// does: an offline phone never hears the revoke, and only a full revoke erases
// field data (owner, 2026-10-18; AvApp plan 54 §7.1a item 5).

import type { RevokeMode } from "@/lib/avserv/device-revoke-types";

export const REVOKE_COPY = {
  sendHelpStays: "Send Help still works from that phone.",
  mode: {
    limited:
      "This phone can still send Send Help and start new trips, but it can't see your account or change any trip you started before.",
    full: "This phone can only send Send Help.",
  } satisfies Record<RevokeMode, string>,
  limitedWhy:
    "This will be a limited sign-out. A full one, which leaves the phone only Send Help, needs a passkey that has been on your account for at least 7 days. That protects you from someone who knows your password but doesn't have your passkey.",
  /** With the due-back time when AvServ sends one (rev 2.1), as the phone says it. */
  liveCheckout: (dueText: string | null) =>
    `This phone has a check-out ${dueText ? `due back at ${dueText}` : "under way"}. After you sign it out, that check-out can't be checked in from this phone, and your contact will be alerted unless you check in from another phone.`,
  liveHelp: "This phone has an open Send Help. Signing the phone out doesn't close it.",
  liveOther: "This phone has another open safety item. Signing the phone out doesn't stop it.",
  whatThePhoneDoes:
    "The next time the phone connects, it shows that it was signed out and removes your trips, contacts and check-out history.",
  // Field data depends on the mode: a password alone mustn't be able to destroy
  // someone's fieldwork, so only a full revoke erases it.
  fieldData: {
    limited: "Your field observations and photos on it are kept, locked, until the phone is signed back in.",
    full: "Unsynced observations and photos on that phone will be erased.",
  } satisfies Record<RevokeMode, string>,
  limits:
    "A phone that stays offline won't hear about this, so also use the phone's own passcode and Find My (iPhone) or Find My Device (Android). Photos saved to the phone's camera roll aren't covered.",
  permanent: "This can't be undone. To use the phone again, link it as a new phone.",
} as const;
