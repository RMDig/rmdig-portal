import { z } from "zod";

// The test personas seeded into the preview Neon project's `preview-seed`
// branch, the parent of the branch previews use (runbook "Preview deployments"). Each persona is the
// operator's own address with a plus tag, so any email a preview does send
// lands in the operator's inbox. "+restricted" is the tag the AvServ mock
// answers with an active restriction (lib/avserv/restrictions-mock.ts).

export type PreviewPersona = {
  tag: "admin" | "user" | "sar" | "advertiser" | "restricted";
  email: string;
  name: string;
};

const BaseEmail = z
  .string()
  .email()
  .refine((e) => !e.split("@")[0]!.includes("+"), "use an address without a +tag");

export function previewPersonas(baseEmail: string): PreviewPersona[] {
  const base = BaseEmail.parse(baseEmail.trim().toLowerCase());
  const [local, domain] = base.split("@") as [string, string];
  const at = (tag: PreviewPersona["tag"]) => `${local}+${tag}@${domain}`;
  return [
    { tag: "admin", email: at("admin"), name: "Preview Admin" },
    { tag: "user", email: at("user"), name: "Preview User" },
    { tag: "sar", email: at("sar"), name: "Preview SAR Lead" },
    { tag: "advertiser", email: at("advertiser"), name: "Preview Advertiser" },
    { tag: "restricted", email: at("restricted"), name: "Preview Restricted" },
  ];
}

// Shared by every persona; never committed. Long enough that a preview URL
// someone stumbles on can't be guessed into.
export const SeedPassword = z.string().min(16, "PREVIEW_SEED_PASSWORD must be at least 16 characters");
