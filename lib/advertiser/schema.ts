import { z } from "zod";

import { advertiserRole } from "../db/schema";

// Shared validation for the advertiser-portal forms (P2, docs/plans/30 §3). The
// server actions validate submitted FormData against these; the client forms
// mirror the same rules. Field names match the forms' FormData keys.

// Optional free-text field from FormData: an empty string (the browser sends ""
// for a blank input) collapses to undefined so it stores as NULL, not "". Mirrors
// the helper in lib/sar/schema.ts.
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

// Optional URL field: blank → undefined (NULL); otherwise must be a valid
// http(s) URL. Used for the advertiser's website.
const optionalUrl = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().url("Enter a valid URL (including https://).").max(max).optional(),
  );

export const createAdvertiserAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter the advertiser's name.").max(200),
  contactName: z.string().trim().min(1, "Enter a primary contact name.").max(200),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid contact email.")
    .max(320),
  contactPhone: optionalText(40),
  websiteUrl: optionalUrl(500),
  // The terms acknowledgment checkbox. An unchecked box is absent from FormData
  // (→ undefined); "on" is the value of a checked one. Mirrors lib/sar/schema.ts.
  tosAccepted: z
    .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
    .refine((v) => v === true, { message: "You must accept the terms to continue." }),
});

export type CreateAdvertiserAccountInput = z.infer<typeof createAdvertiserAccountSchema>;

// Role values derive from the advertiser_role enum so the form, action, and column
// can't drift. Invites default to `editor` (least privilege; admins promote later).
export const advertiserRoleValues = advertiserRole.enumValues;

export const inviteAdvertiserMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(320),
  role: z.enum(advertiserRoleValues),
});

export type InviteAdvertiserMemberInput = z.infer<typeof inviteAdvertiserMemberSchema>;
