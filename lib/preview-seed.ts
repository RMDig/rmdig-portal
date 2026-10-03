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

/** `<base email> [--admin <email>]...`. Each --admin address becomes one more
 *  preview account with rmdig_admin, so you can sign in to previews as
 *  yourself. Previews never hold production accounts; this is a separate
 *  account that happens to share your address. */
export function parseSeedArgs(argv: string[]): { base: string; extraAdmins: string[] } {
  const [base, ...rest] = argv;
  if (!base || base.startsWith("--")) throw new Error("missing <base email>");
  const extraAdmins: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag !== "--admin" || !value) throw new Error(`unexpected argument: ${flag ?? ""}`);
    extraAdmins.push(z.string().email().parse(value.trim().toLowerCase()));
  }
  return { base, extraAdmins: [...new Set(extraAdmins)] };
}

// Shared by every persona; never committed. Long enough that a preview URL
// someone stumbles on can't be guessed into.
export const SeedPassword = z.string().min(16, "PREVIEW_SEED_PASSWORD must be at least 16 characters");
