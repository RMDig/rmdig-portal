import { z } from "zod";

import { operatingStatus } from "../db/schema";
import { RegionPolygonSchema } from "./geo";

// Shared validation for the SAR org creation form (/sar/new). The server action
// validates submitted FormData against this; the client form mirrors the same
// rules. Field names match the form's FormData keys. The proof document is a
// File and is validated separately in lib/blob/upload.ts — a File can't
// round-trip through Zod from FormData cleanly.

// Operating-status options derived from the DB enum so the form, the action, and
// the column never drift. `other` requires the free-text detail (refine below).
export const operatingStatusValues = operatingStatus.enumValues;

// Optional free-text field from FormData: an empty string (the browser sends ""
// for a blank input) collapses to undefined so it stores as NULL, not "".
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max).optional(),
  );

// The map serializes the drawn polygon to a JSON string in a hidden field. Parse
// it, then validate the GeoJSON, so a missing/garbled region is a field-level
// error on `region` rather than a 500 deep in the insert. A non-string or
// unparseable value passes through unchanged and fails RegionPolygonSchema
// cleanly (wrong shape) instead of throwing.
const regionField = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}, RegionPolygonSchema);

export const createSarOrgSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your organization's name.").max(200),
    description: optionalText(2000),
    regionName: optionalText(200),
    contactName: z.string().trim().min(1, "Enter a primary contact name.").max(200),
    contactEmail: z.string().trim().toLowerCase().email("Enter a valid contact email.").max(320),
    contactPhone: optionalText(40),
    operatingStatus: z.enum(operatingStatusValues),
    operatingStatusOther: optionalText(200),
    region: regionField,
    // The TOS acknowledgment checkbox. An unchecked box is absent from FormData
    // (→ undefined); "on" is the value of a checked one.
    tosAccepted: z
      .preprocess((v) => v === "on" || v === "true" || v === true, z.boolean())
      .refine((v) => v === true, { message: "You must accept the terms to submit." }),
  })
  // When the type is "other", the free-text detail is required — that's the only
  // thing telling an operator what kind of organization is applying.
  .refine((v) => v.operatingStatus !== "other" || !!v.operatingStatusOther, {
    message: "Describe your organization type.",
    path: ["operatingStatusOther"],
  });

export type CreateSarOrgInput = z.infer<typeof createSarOrgSchema>;
