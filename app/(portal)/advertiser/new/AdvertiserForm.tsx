"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdvertiserAccountAction } from "./actions";

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700 dark:text-red-400">{errors.join(", ")}</p>;
}

export function AdvertiserForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createAdvertiserAccountAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push(`/advertiser/${state.advertiserId}/members`);
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Advertiser</h2>
        <div className="space-y-2">
          <Label htmlFor="name">Business / organization name</Label>
          <Input id="name" name="name" required aria-invalid={!!fieldErrors?.name} />
          <FieldError errors={fieldErrors?.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="websiteUrl">Website (optional)</Label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            placeholder="https://example.com"
            aria-invalid={!!fieldErrors?.websiteUrl}
          />
          <FieldError errors={fieldErrors?.websiteUrl} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Primary contact</h2>
        <div className="space-y-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input
            id="contactName"
            name="contactName"
            required
            aria-invalid={!!fieldErrors?.contactName}
          />
          <FieldError errors={fieldErrors?.contactName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact email</Label>
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            aria-invalid={!!fieldErrors?.contactEmail}
          />
          <FieldError errors={fieldErrors?.contactEmail} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactPhone">Contact phone (optional)</Label>
          <Input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            aria-invalid={!!fieldErrors?.contactPhone}
          />
          <FieldError errors={fieldErrors?.contactPhone} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>DRAFT — pending legal review.</strong> Every ad creative is manually reviewed
          before it can appear in the app. By continuing, you confirm you&apos;re authorized to
          represent this advertiser and that the information is accurate.
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="tosAccepted" className="mt-0.5" />
          <span>I&apos;m authorized to represent this advertiser and accept the draft terms above.</span>
        </label>
        <FieldError errors={fieldErrors?.tosAccepted} />
      </section>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create advertiser account"}
      </Button>
    </form>
  );
}
