"use client";

import { useState, type FormEvent } from "react";

// Keeps what someone typed when a form action sends back an error. React 19
// resets uncontrolled fields after every form action, to their defaultValue;
// controlled fields would break password-manager autofill (the sign-in form
// learned this). So fields stay uncontrolled, `capture` reads the submitted
// values from the DOM on submit, and the form uses `values` as defaultValues.
//
// Only the keys in `initial` are kept: leave out what should clear on retry
// (passwords, codes) and consent boxes, which are asked for again.

type Values = Record<string, string | string[]>;

/** The submitted values for `prev`'s keys; a field missing from the form keeps its value. */
export function submittedValues<T extends Values>(prev: T, fd: FormData): T {
  const next: Values = { ...prev };
  for (const key of Object.keys(prev)) {
    if (Array.isArray(prev[key])) {
      next[key] = fd.getAll(key).filter((v): v is string => typeof v === "string");
    } else {
      const v = fd.get(key);
      if (typeof v === "string") next[key] = v;
    }
  }
  return next as T;
}

export function useSubmittedValues<T extends Values>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  function capture(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    setValues((prev) => submittedValues(prev, fd));
  }
  return { values, capture };
}
