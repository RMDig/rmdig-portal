"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RegionDrawMap, { type DrawnPolygon } from "@/components/map/RegionDrawMap";
import { VerifiedPhoneField } from "@/components/portal/VerifiedPhoneField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  ContactFields,
  EMPTY_ORG_FIELDS,
  FieldError,
  OrgDetailsFields,
  ProofHint,
  SERVICE_AREA_HELP,
} from "../SarOrgFields";
import { createSarOrgAction } from "./actions";
import { useSubmittedValues } from "@/components/forms/use-submitted-values";
import { ProofDocInput } from "../ProofDocInput";

export function SarOrgForm({ phoneVerifyEnabled }: { phoneVerifyEnabled: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createSarOrgAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const [region, setRegion] = useState<DrawnPolygon | null>(null);
  const onRegionChange = useCallback((p: DrawnPolygon | null) => setRegion(p), []);
  const [orgType, setOrgType] = useState("sar_team");
  // What was typed survives a rejected submit (React resets the form).
  const { values, capture } = useSubmittedValues(EMPTY_ORG_FIELDS);

  useEffect(() => {
    if (state?.ok) router.push("/sar/pending");
  }, [state, router]);

  return (
    <form action={formAction} onSubmit={capture} className="space-y-8">
      <input type="hidden" name="region" value={region ? JSON.stringify(region) : ""} />

      <OrgDetailsFields initial={values} fieldErrors={fieldErrors} onOrgTypeChange={setOrgType} />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Primary contact</h2>
        <ContactFields initial={values} fieldErrors={fieldErrors} />
        <VerifiedPhoneField enabled={phoneVerifyEnabled} fieldErrors={fieldErrors} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Service area</h2>
        <p className="text-muted-foreground text-sm">{SERVICE_AREA_HELP}</p>
        <RegionDrawMap onRegionChange={onRegionChange} hasRegion={!!region} />
        {process.env.NEXT_PUBLIC_E2E === "1" ? (
          // Test-only seam: the headless E2E can't reliably draw on the map
          // canvas/tiles, so under NEXT_PUBLIC_E2E it sets the region by pasting
          // GeoJSON. The flag is set only by the Playwright build — never in
          // production, so this is not rendered for real users.
          <textarea
            data-testid="e2e-region-input"
            aria-label="E2E region input"
            className="border-input flex w-full rounded-md border px-3 py-2 text-xs"
            onChange={(e) => {
              try {
                setRegion(JSON.parse(e.target.value) as DrawnPolygon);
              } catch {
                setRegion(null);
              }
            }}
          />
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="regionName">Region name (optional)</Label>
          <Input
            id="regionName"
            name="regionName"
            defaultValue={values.regionName}
            placeholder="e.g. San Juan County, CO"
            aria-invalid={!!fieldErrors?.regionName}
          />
          <FieldError errors={fieldErrors?.regionName} />
        </div>
        <FieldError errors={fieldErrors?.region} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Proof of operating status</h2>
        <ProofHint orgType={orgType} />
        <ProofDocInput required serverErrors={fieldErrors?.proofDoc} />
      </section>

      <section className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Terms under review by counsel.</strong> By submitting, you confirm you&apos;re
          authorized to represent this organization and that the information is accurate. Final terms
          of service will be provided before approval.
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="tosAccepted" className="mt-0.5" />
          <span>I&apos;m authorized to register this organization and accept the draft terms above.</span>
        </label>
        <FieldError errors={fieldErrors?.tosAccepted} />
      </section>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
