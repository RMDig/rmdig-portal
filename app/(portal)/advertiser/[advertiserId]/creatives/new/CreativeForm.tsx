"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AdSlotPreview } from "@/components/advertiser/AdSlotPreview";
import { TargetPicker, type InitialTarget } from "@/components/advertiser/TargetPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BUYABLE_SLOTS,
  SLOT_LABEL,
  type BuyableSlot,
} from "@/lib/advertiser/creative-schema";
import type { GeoUnit } from "@/lib/geo/types";
import { updateCreativeAction } from "../[creativeId]/edit/actions";
import { createCreativeAction } from "./actions";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700 dark:text-red-400">{errors.join(", ")}</p>;
}

export interface CreativeInitial {
  campaignName: string;
  slot: BuyableSlot;
  headline: string;
  body: string;
  altText: string;
  clickUrl: string | null;
  target: InitialTarget;
}

// Creates a creative, or (with creativeId + initial) edits a draft or
// sent-back one. Either way, saving opens the creative's page.
export function CreativeForm({
  advertiserId,
  states,
  creativeId,
  initial,
}: {
  advertiserId: string;
  states: GeoUnit[];
  creativeId?: string;
  initial?: CreativeInitial;
}) {
  const router = useRouter();
  const action = creativeId
    ? updateCreativeAction.bind(null, advertiserId, creativeId)
    : createCreativeAction.bind(null, advertiserId);
  const [state, formAction, pending] = useActionState(action, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  // Controlled, so a rejected save keeps what was typed (React 19 resets
  // uncontrolled fields after a form action), and the preview renders live.
  const [campaignName, setCampaignName] = useState(initial?.campaignName ?? "");
  const [slot, setSlot] = useState<BuyableSlot>(initial?.slot ?? "post_checkin");
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [clickUrl, setClickUrl] = useState(initial?.clickUrl ?? "");
  const [altText, setAltText] = useState(initial?.altText ?? "");

  useEffect(() => {
    if (state?.ok) router.push(`/advertiser/${advertiserId}/creatives/${state.creativeId}`);
  }, [state, advertiserId, router]);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
    <form action={formAction} className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Placement</h2>
        <div className="space-y-2">
          <Label htmlFor="campaignName">Campaign</Label>
          <Input
            id="campaignName"
            name="campaignName"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g. Spring 2026 awareness"
            required
            aria-invalid={!!fieldErrors?.campaignName}
          />
          <p className="text-muted-foreground text-xs">
            Groups your creatives. Reuse a name to add to an existing campaign.
          </p>
          <FieldError errors={fieldErrors?.campaignName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slot">Where it appears</Label>
          <select
            id="slot"
            name="slot"
            value={slot}
            onChange={(e) => setSlot(e.target.value as BuyableSlot)}
            className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
          >
            {BUYABLE_SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABEL[s]}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Ads only ever appear <strong>after</strong> a safety action resolves — never before one.
          </p>
          <FieldError errors={fieldErrors?.slot} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Content</h2>
        <div className="space-y-2">
          <Label htmlFor="headline">Headline</Label>
          <Input
            id="headline"
            name="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={80}
            required
            aria-invalid={!!fieldErrors?.headline}
          />
          <FieldError errors={fieldErrors?.headline} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="body">Body</Label>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={200}
            rows={3}
            required
            className="border-input bg-transparent flex w-full rounded-md border px-3 py-2 text-sm shadow-xs"
            aria-invalid={!!fieldErrors?.body}
          />
          <FieldError errors={fieldErrors?.body} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="altText">Alt text (for screen readers)</Label>
          <Input
            id="altText"
            name="altText"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            maxLength={200}
            required
            aria-invalid={!!fieldErrors?.altText}
          />
          <FieldError errors={fieldErrors?.altText} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clickUrl">Tap-through link (optional)</Label>
          <Input
            id="clickUrl"
            name="clickUrl"
            type="url"
            value={clickUrl}
            onChange={(e) => setClickUrl(e.target.value)}
            placeholder="https://example.com"
            aria-invalid={!!fieldErrors?.clickUrl}
          />
          <FieldError errors={fieldErrors?.clickUrl} />
        </div>
      </section>

      <TargetPicker states={states} initial={initial?.target} />
      <FieldError errors={fieldErrors?.target} />

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : creativeId ? "Save changes" : "Save draft"}
      </Button>
    </form>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <AdSlotPreview
          slot={slot}
          headline={headline}
          body={body}
          clickUrl={clickUrl || null}
          altText={altText}
        />
      </aside>
    </div>
  );
}
