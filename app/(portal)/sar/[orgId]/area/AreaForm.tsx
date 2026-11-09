"use client";

import { useActionState, useState } from "react";

import RegionPreviewMap, { type PreviewPolygon } from "@/components/map/RegionPreviewMap";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { Button } from "@/components/ui/button";

import { type AreaChoice, AreaEditor } from "../../AreaEditor";
import { FieldError } from "../../SarOrgFields";
import { saveAreaAction } from "./actions";

const km2 = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)} km²`;

// An approved team redraws its service area (plan 33 D3). The current area
// shows until the admin chooses to redraw; the editor then checks each new
// area and shows its warnings (steps 9.5–9.6). Warnings never stop the save.
export function AreaForm({ orgId, region }: { orgId: string; region: PreviewPolygon | null }) {
  const [state, formAction, pending] = useActionState(saveAreaAction.bind(null, orgId), null);
  const [redraw, setRedraw] = useState(region === null);
  const [choice, setChoice] = useState<AreaChoice>({ area: null, clipped: false });

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

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
      {redraw ? (
        <>
          <AreaEditor orgId={orgId} onChange={setChoice} />
          {region ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRedraw(false);
                setChoice({ area: null, clipped: false });
              }}
            >
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

      <FieldError errors={fieldErrors?.region} />
      {state && !state.ok && !fieldErrors ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
      {redraw ? (
        <Button type="submit" disabled={pending || !choice.area}>
          {pending ? "Saving…" : choice.clipped ? "Save the area without the overlap" : "Save the new area"}
        </Button>
      ) : null}
    </form>
  );
}
