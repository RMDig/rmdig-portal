"use client";

import { useActionState, type ReactNode } from "react";

import { submitCollectionSignupAction } from "./actions";
import { useSubmittedValues } from "@/components/forms/use-submitted-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const textareaClass = "w-full rounded-md border bg-transparent p-2 text-sm";

function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-xs text-neutral-500 dark:text-neutral-400">{hint}</p> : null}
      {children}
      {errors ? <p className="text-xs text-red-700">{errors.join(", ")}</p> : null}
    </div>
  );
}

export function CollectionSignupForm() {
  const [state, formAction, pending] = useActionState(submitCollectionSignupAction, null);
  const { values, capture } = useSubmittedValues({
    name: "",
    email: "",
    phone: "",
    city: "",
    state: "",
    backcountryExperience: "",
    hasEquipment: "",
    dataExperience: "",
    motivation: "",
  });
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-900 dark:text-green-200">
        Thanks for signing up! We read every sign-up and will email you if there&apos;s a
        spot on the data-collection team this season.
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={capture} className="space-y-5">
      {/* Honeypot: off-screen and out of the tab order, so only bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website (leave blank)</label>
        <input type="text" id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <Field id="name" label="Your name" errors={fe?.name}>
        <Input id="name" name="name" autoComplete="name" required maxLength={100} defaultValue={values.name} aria-invalid={!!fe?.name} />
      </Field>
      <Field id="email" label="Email" hint="Where we'll contact you." errors={fe?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={values.email} aria-invalid={!!fe?.email} />
      </Field>
      <Field id="phone" label="Phone number (optional)" errors={fe?.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={30} defaultValue={values.phone} aria-invalid={!!fe?.phone} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="city" label="City" hint="Where you're based." errors={fe?.city}>
          <Input id="city" name="city" autoComplete="address-level2" required maxLength={100} defaultValue={values.city} aria-invalid={!!fe?.city} />
        </Field>
        <Field id="state" label="State" errors={fe?.state}>
          <Input id="state" name="state" autoComplete="address-level1" required maxLength={50} defaultValue={values.state} aria-invalid={!!fe?.state} />
        </Field>
      </div>
      <Field
        id="backcountryExperience"
        label="Backcountry experience"
        hint="What experience do you have in the winter backcountry? Any avalanche training?"
        errors={fe?.backcountryExperience}
      >
        <textarea id="backcountryExperience" name="backcountryExperience" required maxLength={1000} rows={3} defaultValue={values.backcountryExperience} className={textareaClass} aria-invalid={!!fe?.backcountryExperience} />
      </Field>
      <Field
        id="hasEquipment"
        label="Do you have a shovel, a probe, and skis or a splitboard with skins?"
        errors={fe?.hasEquipment}
      >
        <select id="hasEquipment" name="hasEquipment" required defaultValue={values.hasEquipment} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" aria-invalid={!!fe?.hasEquipment}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field
        id="dataExperience"
        label="Data experience"
        hint="Any experience with data, analysis, or AI? None is needed."
        errors={fe?.dataExperience}
      >
        <textarea id="dataExperience" name="dataExperience" required maxLength={1000} rows={2} defaultValue={values.dataExperience} className={textareaClass} aria-invalid={!!fe?.dataExperience} />
      </Field>
      <Field id="motivation" label="What made you want to join?" errors={fe?.motivation}>
        <textarea id="motivation" name="motivation" required maxLength={1000} rows={3} defaultValue={values.motivation} className={textareaClass} aria-invalid={!!fe?.motivation} />
      </Field>

      {state && !state.ok && !fe ? <p className="text-sm text-red-700">{state.error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Sign up"}
      </Button>
    </form>
  );
}
