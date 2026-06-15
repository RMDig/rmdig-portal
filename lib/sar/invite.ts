import { z } from "zod";

import { orgRole } from "../db/schema";

// Shared validation for inviting a member to a SAR org. Server-side only (imported
// by the members action); the form inlines the role options to stay client-light.
// Role values derive from the org_role enum so the form, action, and column can't
// drift. Invites default to `responder` (least privilege; admins promote later).

export const orgRoleValues = orgRole.enumValues;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(320),
  role: z.enum(orgRoleValues),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
