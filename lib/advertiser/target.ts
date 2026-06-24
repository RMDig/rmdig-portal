import { z } from "zod";

import type { CreativeTarget } from "@/lib/avserv/client";

// The ad-targeting model shared by the authoring form, the create action, and the
// publish path (AD-P7b, AvApp doc 31 §3). The canonical wire type is `CreativeTarget`
// (lib/avserv/client); this module adds the Zod validator, FormData parsing, and the
// two-way mapping to the `ad_creatives.target_*` columns. Pure (no node:fs) so it's
// importable from anywhere; FIPS *existence* is checked separately server-side against
// the bundled Census data (lib/geo/lookup) since this layer can't see it.

export const ADMIN_LEVELS = ["state", "county", "place"] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

// FIPS code length by level: 2-digit state, 5-digit county, 7-digit place GEOID.
const FIPS_LEN: Record<AdminLevel, number> = { state: 2, county: 5, place: 7 };

// Radius bounds mirror the DB CHECK (5–250 mi) and the AvApp picker spec (doc 31 §3).
export const RADIUS_MIN_MI = 5;
export const RADIUS_MAX_MI = 250;

// Discriminated union over `kind`. `z.coerce` lets the schema validate raw FormData
// strings directly. The superRefine ties each admin FIPS's length to its level so a
// county code can't be submitted under `level: "state"`.
export const adTargetSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("national") }),
    z.object({
      kind: z.literal("radius"),
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
      mi: z.coerce.number().int().min(RADIUS_MIN_MI).max(RADIUS_MAX_MI),
    }),
    z.object({
      kind: z.literal("admin"),
      level: z.enum(ADMIN_LEVELS),
      fips: z.array(z.string().regex(/^\d+$/, "FIPS must be digits")).min(1, "Pick at least one area."),
    }),
  ])
  .superRefine((t, ctx) => {
    if (t.kind === "admin") {
      const want = FIPS_LEN[t.level];
      if (t.fips.some((f) => f.length !== want)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fips"],
          message: `Each ${t.level} FIPS must be ${want} digits.`,
        });
      }
    }
  });

// The validated target is structurally the wire type.
export type AdTarget = z.infer<typeof adTargetSchema> & CreativeTarget;

/**
 * Build and validate an {@link AdTarget} from the creative form's FormData. The form
 * posts `targetKind` plus kind-specific fields; admin FIPS arrive as repeated `fips`
 * inputs (read with getAll, which Object.fromEntries would collapse). Returns a Zod
 * SafeParseReturnType so the action can surface field errors.
 */
export function parseTargetFromFormData(fd: FormData) {
  const kind = fd.get("targetKind");
  if (kind === "radius") {
    return adTargetSchema.safeParse({
      kind: "radius",
      lat: fd.get("targetLat"),
      lon: fd.get("targetLon"),
      mi: fd.get("targetRadiusMi"),
    });
  }
  if (kind === "admin") {
    return adTargetSchema.safeParse({
      kind: "admin",
      level: fd.get("targetAdminLevel"),
      fips: fd.getAll("fips").map(String),
    });
  }
  // Anything else (including a missing field) is national/app-wide — the safe default.
  return adTargetSchema.safeParse({ kind: "national" });
}

/** The `ad_creatives.target_*` columns for an insert/update. numeric lat/lon are
 *  stored as strings (Drizzle `numeric`); unused columns are explicit null so the row
 *  always satisfies the per-kind CHECK. */
export interface TargetColumns {
  targetKind: AdTarget["kind"];
  targetLat: string | null;
  targetLon: string | null;
  targetRadiusMi: number | null;
  targetAdminLevel: AdminLevel | null;
  targetAdminFips: string[] | null;
}

export function adTargetToColumns(t: CreativeTarget): TargetColumns {
  const base: TargetColumns = {
    targetKind: t.kind,
    targetLat: null,
    targetLon: null,
    targetRadiusMi: null,
    targetAdminLevel: null,
    targetAdminFips: null,
  };
  if (t.kind === "radius") {
    return { ...base, targetLat: String(t.lat), targetLon: String(t.lon), targetRadiusMi: t.mi };
  }
  if (t.kind === "admin") {
    return { ...base, targetAdminLevel: t.level, targetAdminFips: t.fips };
  }
  return base;
}

/** Inverse of {@link adTargetToColumns}: read the stored columns back into the wire
 *  target. Falls back to national if a radius/admin payload is somehow incomplete, so
 *  a malformed row never produces a malformed target (the DB CHECK makes that path
 *  unreachable in practice). */
export function columnsToAdTarget(c: {
  targetKind: AdTarget["kind"];
  targetLat: string | null;
  targetLon: string | null;
  targetRadiusMi: number | null;
  targetAdminLevel: AdminLevel | null;
  targetAdminFips: string[] | null;
}): CreativeTarget {
  if (c.targetKind === "radius" && c.targetLat != null && c.targetLon != null && c.targetRadiusMi != null) {
    return { kind: "radius", lat: Number(c.targetLat), lon: Number(c.targetLon), mi: c.targetRadiusMi };
  }
  if (c.targetKind === "admin" && c.targetAdminLevel && c.targetAdminFips?.length) {
    return { kind: "admin", level: c.targetAdminLevel, fips: c.targetAdminFips };
  }
  return { kind: "national" };
}
