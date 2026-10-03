"use client";

import Link from "next/link";
import { useActionState, useCallback, useState } from "react";

import RegionDrawMap, { type DrawnPolygon } from "@/components/map/RegionDrawMap";
import RegionPreviewMap, { type PreviewPolygon } from "@/components/map/RegionPreviewMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  ContactFields,
  FieldError,
  OrgDetailsFields,
  ProofHint,
  SERVICE_AREA_HELP,
  type OrgFieldValues,
} from "../../SarOrgFields";
import { updateSarOrgAction } from "./actions";

// Edit and resubmit a pending application. Inputs are uncontrolled with
// defaultValue, so a rejected submit keeps what was typed. The area and proof
// document are kept unless replaced.
export function EditOrgForm({
  orgId,
  initial,
  region,
  contactPhone,
}: {
  orgId: string;
  initial: OrgFieldValues;
  region: PreviewPolygon | null;
  contactPhone: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateSarOrgAction.bind(null, orgId), null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const [orgType, setOrgType] = useState(initial.orgType);
  const [redraw, setRedraw] = useState(region === null);
  const [newRegion, setNewRegion] = useState<DrawnPolygon | null>(null);
  const onRegionChange = useCallback((p: DrawnPolygon | null) => setNewRegion(p), []);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
          Your application was resubmitted. We&apos;ll email you when there&apos;s a decision.
        </p>
        <Button asChild variant="outline">
          <Link href="/sar/pending">See its status</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="region" value={redraw && newRegion ? JSON.stringify(newRegion) : ""} />

      <OrgDetailsFields initial={initial} fieldErrors={fieldErrors} onOrgTypeChange={setOrgType} />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Primary contact</h2>
        <ContactFields initial={initial} fieldErrors={fieldErrors} />
        <p className="text-muted-foreground text-sm">
          Phone: {contactPhone ?? "none on file"}. To change a verified phone number, contact support.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Service area</h2>
        <p className="text-muted-foreground text-sm">{SERVICE_AREA_HELP}</p>
        {redraw ? (
          <>
            <RegionDrawMap onRegionChange={onRegionChange} hasRegion={!!newRegion} />
            {region ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setRedraw(false)}>
                Keep the current area
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <RegionPreviewMap polygon={region} />
            <Button type="button" variant="outline" size="sm" onClick={() => setRedraw(true)}>
              Redraw the area
            </Button>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="regionName">Region name (optional)</Label>
          <Input id="regionName" name="regionName" defaultValue={initial.regionName} />
          <FieldError errors={fieldErrors?.regionName} />
        </div>
        <FieldError errors={fieldErrors?.region} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Proof of operating status</h2>
        <ProofHint orgType={orgType} />
        <p className="text-muted-foreground text-sm">Your current document stays unless you attach a new one.</p>
        <input
          id="proofDoc"
          name="proofDoc"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="text-sm"
          aria-label="Replace proof document (optional)"
        />
        <FieldError errors={fieldErrors?.proofDoc} />
      </section>

      {state && !state.ok && !fieldErrors ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
      <Button type="submit" disabled={pending || (redraw && !newRegion && !region)}>
        {pending ? "Resubmitting…" : "Save and resubmit"}
      </Button>
    </form>
  );
}
