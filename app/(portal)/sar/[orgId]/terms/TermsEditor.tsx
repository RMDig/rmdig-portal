"use client";

import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CAPABILITIES, termsWordingProblems, type CapabilityName } from "@/lib/sar/terms-rules";

import { saveTermsAction } from "./actions";

// Write the team's terms and choose its services. The wording check runs as
// you type; Submit stays disabled until it's clean (the server checks again).
// Uncontrolled textarea + captured draft, so a rejected submit keeps the text.
export function TermsEditor({
  orgId,
  initialBody,
  initialCapabilities,
}: {
  orgId: string;
  initialBody: string;
  initialCapabilities: CapabilityName[];
}) {
  const [state, formAction, pending] = useActionState(saveTermsAction.bind(null, orgId), null);
  const [body, setBody] = useState(initialBody);
  const problems = useMemo(() => termsWordingProblems(body), [body]);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="font-medium">Services your team provides through AvAI</legend>
        <p className="text-muted-foreground text-sm">
          Users see exactly these lines before they accept your terms. Adding a service means users accept
          again; removing one takes effect at their next check-out.
        </p>
        {CAPABILITIES.map((c) => (
          <label key={c.name} className={`flex items-start gap-2 text-sm ${c.offered ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              name="capabilities"
              value={c.name}
              defaultChecked={initialCapabilities.includes(c.name)}
              disabled={!c.offered}
              className="mt-1"
            />
            <span>
              {c.label}
              {c.note ? <span className="text-muted-foreground"> ({c.note})</span> : null}
            </span>
          </label>
        ))}
        {fieldErrors?.capabilities ? <p className="text-sm text-red-600">{fieldErrors.capabilities[0]}</p> : null}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="terms-body" className="font-medium">
          Terms
        </label>
        <p className="text-muted-foreground text-sm">
          What users agree to when they add your team. Say what you do and don&apos;t do. Don&apos;t describe
          availability, hours, coverage, response times or monitoring: your team isn&apos;t watching anyone,
          and users must keep calling 911 in an emergency.
        </p>
        <textarea
          id="terms-body"
          name="body"
          rows={14}
          defaultValue={initialBody}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-md border bg-transparent p-3 text-sm"
        />
        {fieldErrors?.body ? <p className="text-sm text-red-600">{fieldErrors.body[0]}</p> : null}
        {problems.length > 0 ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
            <p className="font-medium">Reword before submitting:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p, i) => (
                <li key={i}>
                  &ldquo;{p.match}&rdquo; ({p.rule})
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state?.ok ? (
        <p className="text-sm text-green-700">
          {state.submitted ? "Submitted. We'll email your admins when it's reviewed." : "Draft saved."}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
          Save draft
        </Button>
        <Button type="submit" name="intent" value="submit" disabled={pending || problems.length > 0}>
          Submit for review
        </Button>
      </div>
    </form>
  );
}
