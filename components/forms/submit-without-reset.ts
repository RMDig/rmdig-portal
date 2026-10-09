"use client";

import { startTransition, type FormEvent } from "react";

// An onSubmit handler that runs a form's action without React resetting the
// form afterwards. React 19 resets every field once a form's `action` has run;
// typed values can be put back (use-submitted-values.ts), but a chosen file
// can't, because browsers won't let a page set a file input. So on the SAR
// application, a rejected submit (say, no service area drawn) silently dropped
// the proof document (2026-10-08). Keep `action` on the form as well: without
// JavaScript the browser posts to it normally.
export function submitWithoutReset(action: (formData: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => action(formData));
  };
}
