"use client";

import { useActionState, useState } from "react";

import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AUDIENCE_LABEL,
  AUDIENCES,
  forbiddenPhrasesIn,
  SEVERITY_LABEL,
  type Severity,
} from "@/lib/announcements/announcements";

import { createAnnouncementAction } from "./actions";
import { useSubmittedValues } from "@/components/forms/use-submitted-values";

// New announcement, with the banner previewed as you type. Inputs are
// uncontrolled with capture-on-submit, so React 19's post-action reset doesn't
// wipe a rejected draft.
export function AnnouncementForm() {
  const [state, formAction, pending] = useActionState(createAnnouncementAction, null);
  const [draft, setDraft] = useState({ message: "", severity: "info" as Severity });
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  // Audience and times survive a rejected submit too (message and type are in `draft`).
  const { values, capture } = useSubmittedValues({ audiences: ["everyone"], startsAt: "", endsAt: "" });
  const flagged = forbiddenPhrasesIn(draft.message);

  return (
    <form
      action={formAction}
      onSubmit={capture}
      onChange={(e) => {
        const f = new FormData(e.currentTarget);
        setDraft({ message: String(f.get("message") ?? ""), severity: (f.get("severity") as Severity) ?? "info" });
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="ann-message">Message (shown to everyone in the audience, max 300 characters)</Label>
        <textarea
          id="ann-message"
          name="message"
          maxLength={300}
          rows={3}
          defaultValue={draft.message}
          className="w-full rounded-md border bg-transparent p-2 text-sm"
        />
        {flagged.length > 0 ? (
          <p className="text-sm text-red-600">Not allowed in public copy: {flagged.join(", ")}.</p>
        ) : null}
        {fieldErrors?.message ? <p className="text-sm text-red-600">{fieldErrors.message[0]}</p> : null}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Type</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" name="severity" value={s} defaultChecked={s === draft.severity} />
              {SEVERITY_LABEL[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Audience</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {AUDIENCES.map((a) => (
            <label key={a} className="flex items-center gap-2">
              <input type="checkbox" name="audiences" value={a} defaultChecked={values.audiences.includes(a)} />
              {AUDIENCE_LABEL[a]}
            </label>
          ))}
        </div>
        {fieldErrors?.audiences ? <p className="text-sm text-red-600">{fieldErrors.audiences[0]}</p> : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ann-start">Starts (Mountain time, empty = now)</Label>
          <input id="ann-start" name="startsAt" type="datetime-local" defaultValue={values.startsAt} className="w-full rounded-md border bg-transparent p-2 text-sm" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ann-end">Ends (Mountain time, empty = until ended)</Label>
          <input id="ann-end" name="endsAt" type="datetime-local" defaultValue={values.endsAt} className="w-full rounded-md border bg-transparent p-2 text-sm" />
          {fieldErrors?.endsAt ? <p className="text-sm text-red-600">{fieldErrors.endsAt[0]}</p> : null}
        </div>
      </div>

      {draft.message ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Preview</p>
          <div className="overflow-hidden rounded-md border">
            <AnnouncementBanner message={draft.message} severity={draft.severity} endsAt={null} />
          </div>
        </div>
      ) : null}

      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-green-700">Announcement saved.</p> : null}
      <Button type="submit" disabled={pending || flagged.length > 0}>
        {pending ? "Saving…" : "Post announcement"}
      </Button>
    </form>
  );
}
