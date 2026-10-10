"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { signUpAction, signUpGoogleAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignUpForm({ advertiserOption }: { advertiserOption: boolean }) {
  const router = useRouter();
  // Carried into the verification link so the user ends up where they were
  // headed (e.g. an invite); the server re-validates it.
  const next = useSearchParams().get("next") ?? "";
  const [state, formAction, pending] = useActionState(signUpAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      router.push(next ? `/verify-email?next=${encodeURIComponent(next)}` : "/verify-email");
    }
  }, [state, router, next]);

  // Email first (beta plan D1a): the password is chosen on the page the
  // emailed link opens. "Continue with Google" submits this same form to its
  // own action, so it carries the intent; formNoValidate skips the email field.
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="intent">What brings you to AvAI?</Label>
        {/* Routing hint only — after email verification, SAR/advertiser picks
            land on their onboarding form. Native select styled like Input (the
            repo has no shadcn Select primitive; not worth adding for one field). */}
        <select
          id="intent"
          name="intent"
          defaultValue="explorer"
          className="border-input bg-transparent dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring md:text-sm"
        >
          <option value="explorer">Explorer — I use the AvAI app</option>
          <option value="sar">Search &amp; Rescue — I represent a SAR team</option>
          {advertiserOption ? <option value="advertiser">Advertiser — I want to advertise on AvAI</option> : null}
        </select>
      </div>

      <Button type="submit" variant="outline" className="w-full" formAction={signUpGoogleAction} formNoValidate>
        Continue with Google
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card text-muted-foreground px-2">or</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!fieldErrors?.email}
        />
        <p className="text-muted-foreground text-xs">
          We&apos;ll email you a link. You choose your password on the page it opens.
        </p>
        {fieldErrors?.email ? (
          <p className="text-xs text-red-700 dark:text-red-400">
            {fieldErrors.email.join(", ")}
          </p>
        ) : null}
      </div>

      {state && !state.ok && !fieldErrors ? (
        <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link…" : "Continue with email"}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"} className="text-foreground font-medium underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
