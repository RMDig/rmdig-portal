import { createCreativeSchema } from "./creative-schema";
import { adTargetToColumns, parseTargetFromFormData } from "./target";
import { allFipsExist } from "../geo/lookup";

// One validation for creating and editing a creative (docs/plans/30 §5; doc 31
// §3 targeting), so the two can't drift. Server-only: it checks admin-area
// FIPS against the bundled Census data, never trusting the client.

type FieldErrors = Record<string, string[] | undefined>;

export type ParsedCreativeForm =
  | { ok: true; data: ReturnType<typeof createCreativeSchema.parse>; targetColumns: ReturnType<typeof adTargetToColumns> }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function parseCreativeForm(formData: FormData): ParsedCreativeForm {
  const parsed = createCreativeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const target = parseTargetFromFormData(formData);
  if (!target.success) {
    return { ok: false, error: "Please fix the targeting.", fieldErrors: { target: [target.error.issues[0]?.message ?? "Invalid targeting."] } };
  }
  if (target.data.kind === "admin" && !allFipsExist(target.data.level, target.data.fips)) {
    return { ok: false, error: "Please fix the targeting.", fieldErrors: { target: ["Some selected areas weren't recognized — re-pick them."] } };
  }
  return { ok: true, data: parsed.data, targetColumns: adTargetToColumns(target.data) };
}
