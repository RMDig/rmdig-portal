"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Fields shared by the application form (/sar/new) and the resubmit form
// (/sar/[orgId]/edit). Option values mirror the DB enums; labels are inlined so
// these client components never pull the server-only db client into the
// browser bundle. The server re-validates against the enums.

export const ORG_TYPE_OPTIONS = [
  { value: "sar_team", label: "Search & rescue team" },
  { value: "ski_patrol", label: "Ski-area patrol" },
] as const;

const OPERATING_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "county_sar", label: "County search & rescue" },
  { value: "state_sar", label: "State search & rescue" },
  { value: "501c3", label: "501(c)(3) nonprofit" },
  { value: "nonprofit", label: "Other nonprofit" },
  { value: "volunteer_group", label: "Volunteer group" },
  { value: "other", label: "Other" },
];

export type FieldErrors = Record<string, string[] | undefined> | undefined;

export interface OrgFieldValues {
  orgType: string;
  name: string;
  description: string;
  operatingStatus: string;
  operatingStatusOther: string;
  contactName: string;
  contactEmail: string;
  regionName: string;
}

export const EMPTY_ORG_FIELDS: OrgFieldValues = {
  orgType: "sar_team",
  name: "",
  description: "",
  operatingStatus: "county_sar",
  operatingStatusOther: "",
  contactName: "",
  contactEmail: "",
  regionName: "",
};

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700 dark:text-red-400">{errors.join(", ")}</p>;
}

const selectClass = "border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs";

export function OrgDetailsFields({
  initial,
  fieldErrors,
  onOrgTypeChange,
}: {
  initial: OrgFieldValues;
  fieldErrors: FieldErrors;
  onOrgTypeChange?: (v: string) => void;
}) {
  const [operatingStatus, setOperatingStatus] = useState(initial.operatingStatus);
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Organization</h2>
      <div className="space-y-2">
        <Label htmlFor="orgType">Type</Label>
        <select
          id="orgType"
          name="orgType"
          defaultValue={initial.orgType}
          onChange={(e) => onOrgTypeChange?.(e.target.value)}
          className={selectClass}
        >
          {ORG_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldError errors={fieldErrors?.orgType} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" required defaultValue={initial.name} aria-invalid={!!fieldErrors?.name} />
        <FieldError errors={fieldErrors?.name} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Public description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={initial.description}
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
          className={selectClass}
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
            defaultValue={initial.operatingStatusOther}
            aria-invalid={!!fieldErrors?.operatingStatusOther}
          />
          <FieldError errors={fieldErrors?.operatingStatusOther} />
        </div>
      ) : null}
    </section>
  );
}

export function ContactFields({ initial, fieldErrors }: { initial: OrgFieldValues; fieldErrors: FieldErrors }) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="contactName">Contact name</Label>
        <Input
          id="contactName"
          name="contactName"
          required
          defaultValue={initial.contactName}
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
          defaultValue={initial.contactEmail}
          aria-invalid={!!fieldErrors?.contactEmail}
        />
        <FieldError errors={fieldErrors?.contactEmail} />
      </div>
    </>
  );
}

/** What counts as proof differs by type; patrols are also called back. */
export function ProofHint({ orgType }: { orgType: string }) {
  return (
    <p className="text-muted-foreground text-sm">
      {orgType === "ski_patrol"
        ? "A letter from the ski area naming your patrol, or a similar document. Before approving, we'll call the ski area's published phone number to confirm."
        : "A county registration letter, 501(c)(3) determination, or similar."}{" "}
      PDF, PNG, or JPG, up to 10 MB.
    </p>
  );
}

// Plain description of the service area: no routing claim, since nothing
// routes alerts to organizations yet (docs/plans/33 §1).
export const SERVICE_AREA_HELP =
  "Draw the area your team serves. Our staff review it with your application.";
