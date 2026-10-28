import { z } from "zod";

// Wire shapes for AvServ's contacts read (plan 05 P-B4, AvServ plan 63 A10),
// shared by the live client (contacts.ts) and the mock. The phone arrives
// masked to its last four digits and the email as `hasEmail`: the portal never
// holds a contact's full details.

/** Account contract §3.17. Parsed as any string so a state AvServ adds later
 *  renders as "not accepted" rather than failing the whole page; only
 *  `accepted` counts toward checking out. */
export const KNOWN_ACCEPTANCE = ["pending", "accepted", "declined", "opted_out", "unreachable"] as const;
export type KnownAcceptance = (typeof KNOWN_ACCEPTANCE)[number];

export const ContactSchema = z.object({
  contactId: z.string().min(1),
  name: z.string(),
  phoneLast4: z.string(),
  hasEmail: z.boolean(),
  acceptance: z.string().min(1),
  acceptedAt: z.string().nullable(),
  lastIntroAt: z.string().nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const ContactPageSchema = z.object({
  contacts: z.array(ContactSchema),
  nextCursor: z.string().min(1).optional(),
});
export type ContactPage = z.infer<typeof ContactPageSchema>;
