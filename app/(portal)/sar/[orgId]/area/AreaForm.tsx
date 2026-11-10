"use client";

import { useActionState, useCallback, useState, useTransition } from "react";

import RegionDrawMap, { type DrawnPolygon } from "@/components/map/RegionDrawMap";
import RegionPreviewMap, { type PreviewPolygon } from "@/components/map/RegionPreviewMap";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button } from "@/components/ui/button";

import { FieldError } from "../../SarOrgFields";
import { type CheckAreaResult, checkAreaAction, saveAreaAction } from "./actions";
import { AreaWarnings } from "./AreaWarnings";

const km2 = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)} km²`;

// An approved team redraws its service area (plan 33 D3). The current area
// shows until the admin chooses to redraw. Each finished drawing is checked
// (step 9.5): its size, the teams it overlaps, and an area without the
// overlap the admin can use instead. Warnings never stop the save.
export function AreaForm({ orgId, region }: { orgId: string; region: PreviewPolygon | null }) {
  const [state, formAction, pending] = useActionState(saveAreaAction.bind(null, orgId), null);
  const [redraw, setRedraw] = useState(region === null);
  const [drawn, setDrawn] = useState<DrawnPolygon | null>(null);
  // The clipped area, once the admin chooses it over their drawing.
  const [clipped, setClipped] = useState<DrawnPolygon | null>(null);
  const [check, setCheck] = useState<CheckAreaResult | null>(null);
  const [checking, startCheck] = useTransition();

  const onRegionChange = useCallback(
    (p: DrawnPolygon | null) => {
      setDrawn(p);
      setClipped(null);
      setCheck(null);
      if (p) startCheck(async () => setCheck(await checkAreaAction(orgId, p)));
    },
    [orgId],
  );

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const chosen = clipped ?? drawn;

  if (state?.ok) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-green-300 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-950">
          {state.sync === "sent"
            ? `Saved. Your service area is now ${km2(state.areaKm2)}, and AvAI has it.`
            : `Saved. Your service area is now ${km2(state.areaKm2)}, but one AvAI server hasn't taken it yet. rmdig staff can see this and send it again.`}
        </p>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          See the new area
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <input type="hidden" name="region" value={redraw && chosen ? JSON.stringify(chosen) : ""} />
      {!redraw ? (
        <>
          <RegionPreviewMap polygon={region} />
          <Button type="button" variant="outline" size="sm" onClick={() => setRedraw(true)}>
            Redraw the area
          </Button>
        </>
      ) : clipped ? (
        <>
          <RegionPreviewMap polygon={clipped} />
          <Button type="button" variant="outline" size="sm" onClick={() => setClipped(null)}>
            Use my drawing instead
          </Button>
        </>
      ) : (
        <>
          <RegionDrawMap onRegionChange={onRegionChange} hasRegion={!!drawn} />
          {region ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setRedraw(false)}>
              Keep the current area
            </Button>
          ) : null}
        </>
      )}

      {redraw && drawn ? (
        <AreaWarnings
          checking={checking}
          check={check}
          usingClip={!!clipped}
          onUseClip={(area) => setClipped(area)}
        />
      ) : null}

      <FieldError errors={fieldErrors?.region} />
      {state && !state.ok && !fieldErrors ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
      {redraw ? (
        <Button type="submit" disabled={pending || !chosen}>
          {pending ? "Saving…" : clipped ? "Save the area without the overlap" : "Save the new area"}
        </Button>
      ) : null}
    </form>
  );
}
