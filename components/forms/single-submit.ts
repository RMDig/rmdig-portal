"use client";

import { useEffect, useRef, type FormEvent } from "react";

// One submission at a time for a form whose action costs something: an App
// Lock reset code or a link code each use a daily allowance. The button is
// disabled while the action runs, but a quick second click lands before React
// re-renders, and useActionState then runs both, one after the other (seen in
// production 2026-10-20: two reset codes one second apart). This drops the
// second submit until the first has finished.

/** The guard on its own, so it can be tested without a DOM. */
export function createSubmitGuard() {
  let busy = false;
  return {
    /** True when this submit may go ahead; false while another is in flight. */
    tryStart: () => (busy ? false : (busy = true)),
    done: () => {
      busy = false;
    },
  };
}

/** An onSubmit for a useActionState form: pass the hook's `pending`. */
export function useSingleSubmit(pending: boolean): (e: FormEvent<HTMLFormElement>) => void {
  const guard = useRef(createSubmitGuard());
  useEffect(() => {
    if (!pending) guard.current.done();
  }, [pending]);
  return (e) => {
    if (!guard.current.tryStart()) e.preventDefault();
  };
}
