import { z } from "zod";

import { orgRole } from "../db/schema";
import { isDrillAddress } from "./drill-address";
import type { AreaAssessment } from "./area-checks";

// Drill teams (plan 37; AvServ plan 66): permanent, marked test teams that
// let the SAR path be tested live without touching a real team. The database
// enforces what a drill team is (migration 0036); this holds the rules the
// portal applies before it writes one.

/** The status-log note on a drill team's registration (plan 37 §4.3). */
export const DRILL_REGISTERED_NOTE = "Registered by the operator as a drill team; nothing outside RMDig verified.";

/** A drill team's largest area: about a 1 km-radius circle (plan 37 §4.4). */
export const DRILL_AREA_MAX_KM2 = 4;

export type DrillAreaCheck = { ok: true } | { ok: false; code: "drill_area_too_large" | "drill_area_overlaps"; message: string };

/**
 * A drill team's limits on top of the ordinary area checks: small, and never
 * over a real team's area. `assessArea` already leaves drill teams out of its
 * overlaps, so every overlap it reports is a real team's.
 */
export function checkDrillArea(a: Extract<AreaAssessment, { ok: true }>): DrillAreaCheck {
  if (a.areaKm2 > DRILL_AREA_MAX_KM2) {
    return {
      ok: false,
      code: "drill_area_too_large",
      message: `A drill team's area can be at most ${DRILL_AREA_MAX_KM2} km², about a 1 km-radius circle. This one is ${a.areaKm2.toFixed(1)} km².`,
    };
  }
  if (a.overlaps.length > 0) {
    return {
      ok: false,
      code: "drill_area_overlaps",
      message: "A drill team's area can't overlap a real team's. Move it to another public spot nearby where no one starts a trip.",
    };
  }
  return { ok: true };
}

/** A circle as a closed polygon ring, for the default drill area. Points are
 *  [lon, lat], rounded to 6 decimals like the sync; good to well under a
 *  metre at this size. */
export function circleRing(center: { lat: number; lon: number }, radiusM: number, points = 32): number[][] {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((center.lat * Math.PI) / 180);
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const ring = Array.from({ length: points }, (_, i) => {
    const t = (2 * Math.PI * i) / points;
    return [round(center.lon + (radiusM * Math.sin(t)) / mPerDegLon), round(center.lat + (radiusM * Math.cos(t)) / mPerDegLat)];
  });
  return [...ring, ring[0]!];
}

/** Where the drill team goes (owner, 2026-11-09; plan 66 O3): a 1 km circle on
 *  the Colorado State Capitol, Denver. Exactness doesn't matter. */
export const DRILL_AREA_DEFAULT = { lat: 39.7393, lon: -104.9848, radiusM: 1000 } as const;

export { DRILL_ADDRESS_RESERVED, isDrillAddress } from "./drill-address";

/** Creating a drill login (plan 37 §4.2): its address and its team role. */
export const drillLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .refine(isDrillAddress, { message: "Use a drill address: a plus address at rmdig.ai tagged drill, e.g. ops+drill1@rmdig.ai." }),
  role: z.enum(orgRole.enumValues),
});

/** The status-log note on a drill team's activation (plan 37 DR1). It is the
 *  record that no independent review took place. */
export const DRILL_ACTIVATED_NOTE = "drill org activated by the operator; not an independent review";
