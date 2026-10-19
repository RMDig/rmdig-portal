import { z } from "zod";

// AvServ docs/contracts/security_events.md rev 1. Specified, not built: the
// portal runs it against the mock.

export const AVSERV_SECURITY_EVENT_KINDS = [
  "register",
  "link",
  "revoke",
  "contact_add",
  "contact_remove",
  "cancel",
] as const;
export type AvServSecurityEventKind = (typeof AVSERV_SECURITY_EVENT_KINDS)[number];

// `kind` is parsed as any string, then filtered against the closed list: a
// kind the portal doesn't know is dropped and only counted, never named
// (plan 36 rule 3), and one unknown event doesn't fail the whole page.
export const FeedPageSchema = z.object({
  accountId: z.string(),
  node: z.string(),
  events: z.array(z.object({ id: z.string(), kind: z.string(), at: z.string(), deviceId: z.string() })),
  nextCursor: z.string().nullable(),
});
export type FeedPage = z.infer<typeof FeedPageSchema>;

export interface AvServSecurityEvent {
  id: string;
  kind: AvServSecurityEventKind;
  at: string;
  deviceId: string;
}

export function isKnownKind(kind: string): kind is AvServSecurityEventKind {
  return (AVSERV_SECURITY_EVENT_KINDS as readonly string[]).includes(kind);
}
