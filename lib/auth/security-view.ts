import { desc, eq } from "drizzle-orm";

import { readSecurityEvents } from "../avserv/security-events";
import type { AvServSecurityEventKind } from "../avserv/security-events-types";
import { db } from "../db";
import { accountSecurityEvents, type AccountSecurityEventKind } from "../db/schema";
import { shortDeviceId } from "../format/device-id";

// The account's security history for /settings/security (plan 36 §5.2): the
// portal's own changes merged with AvServ's feed from every node. Rows say what
// and when, and which phone by a short id: never a contact's name or number
// (none reaches the portal), and nothing plan 36 rule 3 keeps out of the
// portal (it has no kind here at all).

export interface SecurityRow {
  id: string;
  at: Date;
  label: string;
  device: string | null;
}

const PORTAL_LABEL: Record<AccountSecurityEventKind, string> = {
  password_changed: "Password changed",
  password_reset: "Password reset by email link",
  mfa_enabled: "Two-factor authentication turned on",
  mfa_disabled: "Two-factor authentication turned off",
  recovery_codes_regenerated: "New recovery codes made",
  session_revoked: "A browser was signed out",
  sessions_revoked_others: "Every other browser was signed out",
  notices_on: "Security notices turned on",
  notices_off: "Security notices turned off",
};

const AVSERV_LABEL: Record<AvServSecurityEventKind, string> = {
  register: "A phone was registered",
  link: "A phone was linked to your account",
  revoke: "A phone was signed out",
  contact_add: "A contact was added",
  contact_remove: "A contact was removed",
  cancel: "A check-out was cancelled",
};

const PORTAL_ROWS = 200;

export interface SecurityView {
  rows: SecurityRow[];
  /** A server didn't answer, or the history is longer than one view reads. */
  incomplete: boolean;
}

export async function loadSecurityView(userId: string, accountId: string | null): Promise<SecurityView> {
  const portal = await db
    .select({ id: accountSecurityEvents.id, kind: accountSecurityEvents.kind, at: accountSecurityEvents.at })
    .from(accountSecurityEvents)
    .where(eq(accountSecurityEvents.userId, userId))
    .orderBy(desc(accountSecurityEvents.at))
    .limit(PORTAL_ROWS);
  const feed = accountId ? await readSecurityEvents(accountId, userId) : { events: [], incomplete: false, failed: false };

  const rows: SecurityRow[] = [
    ...portal.map((e) => ({ id: e.id, at: e.at, label: PORTAL_LABEL[e.kind], device: null })),
    ...feed.events.map((e) => ({ id: e.id, at: new Date(e.at), label: AVSERV_LABEL[e.kind], device: shortDeviceId(e.deviceId) })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return { rows, incomplete: feed.incomplete || feed.failed };
}
