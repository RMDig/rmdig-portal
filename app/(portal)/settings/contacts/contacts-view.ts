import type { Contact, KnownAcceptance } from "@/lib/avserv/contacts";
import { formatMountain } from "@/lib/format/time";

// What /settings/contacts says about each contact and about the list as a
// whole (AvServ plan 63 A10). Pure, so the wording is tested without a render.

const STATUS: Record<KnownAcceptance, string> = {
  accepted: "Accepted",
  pending: "Waiting for YES",
  declined: "Declined",
  opted_out: "Opted out",
  unreachable: "Can't be reached",
};

function when(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : formatMountain(date);
}

function known(acceptance: string): acceptance is KnownAcceptance {
  return acceptance in STATUS;
}

export interface ContactRow {
  id: string;
  name: string;
  /** "Phone ending 0101 · email on file". */
  reach: string;
  status: string;
  accepted: boolean;
  detail: string;
}

export function contactRow(c: Contact): ContactRow {
  const reach = `Phone ending ${c.phoneLast4}${c.hasEmail ? " · email on file" : ""}`;
  const asked = when(c.lastIntroAt);
  let detail: string;
  switch (c.acceptance) {
    case "accepted": {
      const at = when(c.acceptedAt);
      detail = at ? `Replied YES ${at}.` : "Replied YES.";
      break;
    }
    case "pending":
      detail = asked
        ? `Asked ${asked}. They accept by replying YES to that text.`
        : "Not asked yet. You can send the request from the AvAI app.";
      break;
    case "declined":
      detail = "Said no to being your emergency contact. Choose someone else in the app.";
      break;
    case "opted_out":
      detail = "Replied STOP, so AvAI can't text them until they reply START.";
      break;
    case "unreachable":
      detail = "Texts to this number aren't being delivered. Check the number in the app.";
      break;
    default:
      detail = "Hasn't accepted.";
  }
  return {
    id: c.contactId,
    name: c.name || "Unnamed contact",
    reach,
    status: known(c.acceptance) ? STATUS[c.acceptance] : "Not accepted",
    accepted: c.acceptance === "accepted",
    detail,
  };
}

/** One line on where the user stands: nobody added, nobody accepted, or how
 *  many have. */
export function contactsSummary(contacts: Contact[]): { ready: boolean; text: string } {
  if (contacts.length === 0) {
    return { ready: false, text: "You haven't added an emergency contact yet. Add one in the AvAI app." };
  }
  const accepted = contacts.filter((c) => c.acceptance === "accepted").length;
  if (accepted === 0) {
    return {
      ready: false,
      text:
        contacts.length === 1
          ? "Your contact hasn't accepted yet."
          : `None of your ${contacts.length} contacts has accepted yet.`,
    };
  }
  return {
    ready: true,
    text:
      accepted === contacts.length
        ? contacts.length === 1
          ? "Your contact has accepted."
          : `All ${contacts.length} of your contacts have accepted.`
        : `${accepted} of your ${contacts.length} contacts ${accepted === 1 ? "has" : "have"} accepted.`,
  };
}
