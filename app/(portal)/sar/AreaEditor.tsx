"use client";

import { useRef, useState, useTransition } from "react";

import RegionDrawMap, { type DrawnPolygon } from "@/components/map/RegionDrawMap";
import RegionPreviewMap from "@/components/map/RegionPreviewMap";
import { VertexTable } from "@/components/map/VertexTable";
import { Button } from "@/components/ui/button";

import { checkAreaAction, type CheckAreaResult } from "./area-check-action";
import { AreaWarnings } from "./AreaWarnings";

export interface AreaChoice {
  area: DrawnPolygon | null;
  /** The area without the overlap, chosen over the drawing. */
  clipped: boolean;
}

// The one service-area editor (plan 33 §6.3, step 9.6) for a new application
// (`orgId` null), a resubmit and an approved team's edit. The map and the
// corner-points table edit the same area, so it can be drawn or typed. Each new
// area is checked (area-check-action.ts) and the warnings shown; none blocks
// the save. The chosen area goes to the form as the hidden `region` field.
export function AreaEditor({ orgId, onChange }: { orgId: string | null; onChange?: (choice: AreaChoice) => void }) {
  const [area, setArea] = useState<DrawnPolygon | null>(null);
  const [clipped, setClipped] = useState<DrawnPolygon | null>(null);
  const [check, setCheck] = useState<CheckAreaResult | null>(null);
  const [checking, startCheck] = useTransition();
  // Only the latest area's check is shown; an earlier one can come back later.
  const latest = useRef(0);

  const choose = (next: DrawnPolygon | null) => {
    setArea(next);
    setClipped(null);
    setCheck(null);
    onChange?.({ area: next, clipped: false });
    const n = ++latest.current;
    if (!next) return;
    startCheck(async () => {
      const result = await checkAreaAction(orgId, next);
      if (n === latest.current) setCheck(result);
    });
  };
  const pickClip = (c: DrawnPolygon | null) => {
    setClipped(c);
    onChange?.({ area: c ?? area, clipped: c !== null });
  };

  const chosen = clipped ?? area;
  return (
    <div className="space-y-4" data-testid="area-editor">
      <input type="hidden" name="region" value={chosen ? JSON.stringify(chosen) : ""} />
      {clipped ? (
        <>
          <RegionPreviewMap polygon={clipped} />
          <Button type="button" variant="outline" size="sm" onClick={() => pickClip(null)}>
            Use my drawing instead
          </Button>
        </>
      ) : (
        <>
          <RegionDrawMap region={area} onRegionChange={choose} />
          <VertexTable polygon={area} onApply={choose} />
        </>
      )}
      {area ? <AreaWarnings checking={checking} check={check} usingClip={!!clipped} onUseClip={pickClip} /> : null}
    </div>
  );
}
