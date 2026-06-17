import type { BuyableSlot } from "@/lib/advertiser/creative-schema";

// Faithful, presentational preview of how a creative renders in the app's
// post-resolution slot (AD-P4, docs/plans/30 §4). It reads the EXACT `display`
// shape that ships in the signed manifest's creatives[] (AvApp doc 31 §2:
// { headline, body }) — so what the advertiser previews is what publish writes.
// Pure component (no hooks) so both the server detail page and the client author
// form can render it. It renders nothing live and makes no network call.
//
// The mock deliberately shows the safety-resolution context ABOVE the ad: ads only
// ever appear AFTER a safety action resolves, alongside the confirmation copy —
// never before one (doc 30 §0 bright-line). The preview reinforces that framing.

const SLOT_CONTEXT: Record<
  BuyableSlot,
  { badge: string; title: string; subtitle: string }
> = {
  post_checkin: {
    badge: "✓ Checked in",
    title: "You're checked in",
    subtitle: "We're glad you made it back safe.",
  },
  post_checkout: {
    badge: "✓ Trip armed",
    title: "Heading out",
    subtitle: "Your trip is armed. Stay safe out there.",
  },
};

export interface AdSlotPreviewProps {
  slot: BuyableSlot;
  headline: string;
  body: string;
  /** Optional tap-through; rendered as a non-interactive affordance in the mock. */
  clickUrl?: string | null;
  /** Screen-reader text for the ad surface (the manifest carries this). */
  altText?: string;
}

export function AdSlotPreview({ slot, headline, body, clickUrl, altText }: AdSlotPreviewProps) {
  const ctx = SLOT_CONTEXT[slot];
  const hasContent = headline.trim() !== "" || body.trim() !== "";

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Preview — how this appears in the app
      </p>
      {/* Phone-ish frame */}
      <div className="bg-muted/40 mx-auto max-w-xs rounded-[2rem] border p-3 shadow-sm">
        <div className="bg-background min-h-[28rem] rounded-[1.5rem] border p-5">
          {/* Safety-resolution confirmation (always above the ad) */}
          <div className="space-y-3 text-center">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              {ctx.badge}
            </span>
            <h3 className="text-lg font-semibold">{ctx.title}</h3>
            <p className="text-muted-foreground text-sm">{ctx.subtitle}</p>
          </div>

          {/* The ad surface */}
          <div className="mt-8">
            <div className="text-muted-foreground mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide">
              <span>Sponsored</span>
              {/* Dismiss affordance — ads are always one-tap dismissible (doc 30 §4.1) */}
              <span aria-hidden className="text-sm leading-none">
                ×
              </span>
            </div>
            <div
              className="space-y-1 rounded-lg border bg-card p-3 text-left"
              role="group"
              aria-label={altText || "Sponsored message"}
            >
              {hasContent ? (
                <>
                  <p className="text-sm font-semibold">{headline || "Headline"}</p>
                  <p className="text-muted-foreground text-sm">{body || "Body copy"}</p>
                  {clickUrl ? (
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                      Learn more →
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  Your headline and body will appear here.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
