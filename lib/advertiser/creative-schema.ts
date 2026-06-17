import { z } from "zod";

// Shared validation for the text-creative authoring form (AD-P3, docs/plans/30 §5).
// The server action validates submitted FormData against this; the client form
// mirrors the same rules. Field names match the form's FormData keys.
//
// v1 creatives are TEXT-ONLY — the manifest `display` shape is { headline, body }
// (AvApp doc 31 §2). Image creatives are a later manifest rev and are not authored
// here. Region targeting (forecast_zone_*) is Phase 3 (AD-P7); Phase 2 ships
// app-wide creatives, so there is no region field here.

// The buyable slots an advertiser may author for. The ad_slot DB enum also carries
// `loading_idle`, but that slot is RESERVED — the client isn't wired for it yet
// (AvApp doc 31 §1), so authoring it would produce a creative that never renders.
// We deliberately offer only the two post-resolution slots that ship today; the
// server validates against this same subset.
export const BUYABLE_SLOTS = ["post_checkin", "post_checkout"] as const;
export type BuyableSlot = (typeof BUYABLE_SLOTS)[number];

export const SLOT_LABEL: Record<BuyableSlot, string> = {
  post_checkin: "Check-in confirmation (after “I'm safe”)",
  post_checkout: "Check-out confirmation (after arming a trip)",
};

// Length caps keep a creative legible inside the small post-resolution slot and
// keep the signed manifest compact. Tunable; conservative for v1.
const HEADLINE_MAX = 80;
const BODY_MAX = 200;
const ALT_TEXT_MAX = 200;

// Optional tap-through link: blank → undefined (NULL). Must be an https URL — a
// safety app never ships a plaintext-http ad link.
const optionalHttpsUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .url("Enter a valid link URL.")
    .max(500)
    .refine((u) => u.startsWith("https://"), "Link must start with https://")
    .optional(),
);

export const createCreativeSchema = z.object({
  // A campaign groups creatives under the advertiser. Phase 2 keeps this light: the
  // action find-or-creates a campaign by name under the advertiser.
  campaignName: z.string().trim().min(1, "Name the campaign.").max(200),
  slot: z.enum(BUYABLE_SLOTS, { message: "Choose where this ad appears." }),
  headline: z.string().trim().min(1, "Write a headline.").max(HEADLINE_MAX),
  body: z.string().trim().min(1, "Write the ad body.").max(BODY_MAX),
  altText: z
    .string()
    .trim()
    .min(1, "Add alt text for screen readers.")
    .max(ALT_TEXT_MAX),
  clickUrl: optionalHttpsUrl,
});

export type CreateCreativeInput = z.infer<typeof createCreativeSchema>;
