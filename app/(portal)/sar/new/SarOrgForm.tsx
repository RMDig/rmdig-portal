"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RegionDrawMap, { type DrawnPolygon } from "@/components/map/RegionDrawMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSarOrgAction } from "./actions";

// Operating-status options. Values mirror the operating_status DB enum; labels
// are inlined here (not imported from lib/sar/schema) so this client component
// never pulls the server-only db client into the browser bundle. The server
// re-validates against the enum.
const OPERATING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "county_sar", label: "County search & rescue" },
  { value: "state_sar", label: "State search & rescue" },
  { value: "501c3", label: "501(c)(3) nonprofit" },
  { value: "nonprofit", label: "Other nonprofit" },
  { value: "volunteer_group", label: "Volunteer group" },
  { value: "other", label: "Other" },
];

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700 dark:text-red-400">{errors.join(", ")}</p>;
}

export function SarOrgForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createSarOrgAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  const [region, setRegion] = useState<DrawnPolygon | null>(null);
  const onRegionChange = useCallback((p: DrawnPolygon | null) => setRegion(p), []);
  const [operatingStatus, setOperatingStatus] = useState("county_sar");

  useEffect(() => {
    if (state?.ok) router.push("/sar/pending");
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="region" value={region ? JSON.stringify(region) : ""} />

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Organization</h2>
        <div className="space-y-2">
          <Label htmlFor="name">Organization name</Label>
          <Input id="name" name="name" required aria-invalid={!!fieldErrors?.name} />
          <FieldError errors={fieldErrors?.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Public description (optional)</Label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="border-input bg-transparent flex w-full rounded-md border px-3 py-2 text-sm shadow-xs"
            aria-invalid={!!fieldErrors?.description}
          />
          <FieldError errors={fieldErrors?.description} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="operatingStatus">Operating status</Label>
          <select
            id="operatingStatus"
            name="operatingStatus"
            value={operatingStatus}
            onChange={(e) => setOperatingStatus(e.target.value)}
            className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
          >
            {OPERATING_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors?.operatingStatus} />
        </div>
        {operatingStatus === "other" ? (
          <div className="space-y-2">
            <Label htmlFor="operatingStatusOther">Describe your organization type</Label>
            <Input
              id="operatingStatusOther"
              name="operatingStatusOther"
              aria-invalid={!!fieldErrors?.operatingStatusOther}
            />
            <FieldError errors={fieldErrors?.operatingStatusOther} />
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Primary contact</h2>
        <div className="space-y-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input id="contactName" name="contactName" required aria-invalid={!!fieldErrors?.contactName} />
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
          <Input id="contactPhone" name="contactPhone" type="tel" aria-invalid={!!fieldErrors?.contactPhone} />
          <FieldError errors={fieldErrors?.contactPhone} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Service area</h2>
        <p className="text-muted-foreground text-sm">
          Draw the region your team covers. Alerts route to your org when a person&apos;s last-known
          location falls inside it.
        </p>
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
            placeholder="e.g. San Juan County, CO"
            aria-invalid={!!fieldErrors?.regionName}
          />
          <FieldError errors={fieldErrors?.regionName} />
        </div>
        <FieldError errors={fieldErrors?.region} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Proof of operating status</h2>
        <p className="text-muted-foreground text-sm">
          A county registration letter, 501(c)(3) determination, or similar. PDF, PNG, or JPG, up to
          10 MB.
        </p>
        <div className="space-y-2">
          <input
            id="proofDoc"
            name="proofDoc"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            className="text-sm"
            aria-invalid={!!fieldErrors?.proofDoc}
          />
          <FieldError errors={fieldErrors?.proofDoc} />
        </div>
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
