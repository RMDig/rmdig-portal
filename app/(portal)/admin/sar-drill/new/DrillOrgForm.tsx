"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { VerifiedPhoneField } from "@/components/portal/VerifiedPhoneField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DrawnPolygon } from "@/components/map/RegionDrawMap";

import { AreaEditor } from "../../../sar/AreaEditor";
import { FieldError } from "../../../sar/SarOrgFields";
import { registerDrillOrgAction } from "./actions";

// The drill team form (plan 37 §4.3). The area starts as the owner's chosen
// circle, and can be moved like any other.
export function DrillOrgForm({ phoneVerifyEnabled, defaultArea }: { phoneVerifyEnabled: boolean; defaultArea: DrawnPolygon }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(registerDrillOrgAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) router.push("/admin/sar-drill");
  }, [state, router]);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-8">
      <section className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Team name</Label>
          <Input id="name" name="name" required defaultValue="AvAI Drill Team" aria-invalid={!!fieldErrors?.name} aria-describedby="name-help" />
          <p id="name-help" className="text-muted-foreground text-xs">
            Must contain &quot;drill&quot;. It&apos;s permanent: a drill team can never become a real one.
          </p>
          <FieldError errors={fieldErrors?.name} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Contact</h2>
        <div className="space-y-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input id="contactName" name="contactName" required aria-invalid={!!fieldErrors?.contactName} />
          <FieldError errors={fieldErrors?.contactName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactEmail">Contact email</Label>
          <Input id="contactEmail" name="contactEmail" type="email" required aria-invalid={!!fieldErrors?.contactEmail} />
          <FieldError errors={fieldErrors?.contactEmail} />
        </div>
        <p className="text-muted-foreground text-sm">The phone is the operator&apos;s drill phone. It&apos;s verified like any team&apos;s.</p>
        <VerifiedPhoneField enabled={phoneVerifyEnabled} fieldErrors={fieldErrors} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Service area</h2>
        <p className="text-muted-foreground text-sm">
          At most 4 km², and never over a real team&apos;s area. It starts as a 1 km circle on the
          Colorado State Capitol. If a real team&apos;s area covers that, move it to another public spot
          nearby where no one starts a trip.
        </p>
        <AreaEditor orgId={null} initial={defaultArea} />
        <FieldError errors={fieldErrors?.region} />
        <div className="space-y-2">
          <Label htmlFor="regionName">Region name (optional)</Label>
          <Input id="regionName" name="regionName" defaultValue="Colorado State Capitol, Denver" aria-invalid={!!fieldErrors?.regionName} />
          <FieldError errors={fieldErrors?.regionName} />
        </div>
      </section>

      {state && !state.ok && !fieldErrors ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Registering…" : "Register drill team"}
      </Button>
    </form>
  );
}
