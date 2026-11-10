import type { DrawnPolygon } from "@/components/map/RegionDrawMap";
import { Button } from "@/components/ui/button";

import type { CheckAreaResult } from "./area-check-action";

const km2 = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)} km²`;

// What the check found about a drawn area (plan 33 §6.3 steps 1–2, steps 9.5–9.6).
// Each is a warning: the admin can still save what they drew.
export function AreaWarnings({
  checking,
  check,
  usingClip,
  onUseClip,
}: {
  checking: boolean;
  check: CheckAreaResult | null;
  usingClip: boolean;
  onUseClip: (area: DrawnPolygon) => void;
}) {
  if (checking || !check) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Checking the area…
      </p>
    );
  }
  if (!check.ok) {
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {check.error}
      </p>
    );
  }

  const warn = "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200";
  return (
    <div role="status" className="space-y-3">
      <p className="text-sm">This area is about {km2(check.areaKm2)}.</p>
      {check.large ? (
        <p className={warn}>
          It&apos;s larger than Las Animas County, Colorado&apos;s largest county (about {km2(check.large.thresholdKm2)}). Check that it&apos;s the area your team serves before you save it.
        </p>
      ) : null}
      {check.overlaps.length > 0 ? (
        <div className={`${warn} space-y-2`}>
          <p>
            It overlaps the {check.overlaps.length === 1 ? "area of another team" : "areas of other teams"}:{" "}
            {check.overlaps.map((o, i) => (
              <span key={o.name}>
                {i > 0 ? ", " : ""}
                <strong>{o.name}</strong> ({km2(o.overlapKm2)})
              </span>
            ))}
            . You can still save it as drawn.
          </p>
          {check.clip?.ok ? (
            usingClip ? (
              <p>Using the area without the overlap ({km2(check.clip.areaKm2)}).</p>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => check.clip?.ok && onUseClip(check.clip.area)}>
                Use the area without the overlap ({km2(check.clip.areaKm2)})
              </Button>
            )
          ) : check.clip ? (
            <p>{check.clip.message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
