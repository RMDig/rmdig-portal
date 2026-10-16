"use server";

import { z } from "zod";

import { staffEmails } from "@/lib/auth/staff-recipients";
import { clientIp } from "@/lib/client-ip";
import { sendCollectionSignupEmail } from "@/lib/email/send";
import { logger } from "@/lib/logger";
import { incrementRateLimit } from "@/lib/rate-limit";
import { reportError, reportProblem } from "@/lib/report-error";

// Volunteer sign-up for snowpack data collection, at the exact path the
// pre-cutover site used: news coverage links rmdig.ai/collection_signup, so
// the URL must keep resolving. Public and unauthenticated by nature.
//
// The portal stores nothing: each sign-up is emailed to the rmdig admins and
// that email is the record, as on the old site. So the action only succeeds
// when at least one admin email went out; otherwise the applicant is told to
// try again rather than shown a success that reached nobody.

// One line, no control characters: these land in an email subject and body.
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required")
    .max(max, `Keep it under ${max} characters`)
    .regex(/^[^\p{Cc}]*$/u, "Use a single line");
const answer = z.string().trim().min(1, "Required").max(1000, "Keep it under 1000 characters");

const signupSchema = z.object({
  name: line(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  phone: z
    .string()
    .trim()
    .max(30, "Enter a phone number")
    .regex(/^[0-9+().\-\s]*$/, "Enter a phone number")
    .transform((v) => (v === "" ? undefined : v)),
  city: line(100),
  state: line(50),
  backcountryExperience: answer,
  hasEquipment: z.enum(["yes", "no"], { message: "Choose yes or no" }),
  dataExperience: answer,
  motivation: answer,
});

// 5/hour per IP (the old site's limit) bounds bots and keeps a NAT'd group of
// friends signing up together working. 3/day per address stops one inbox from
// being entered over and over.
const IP_RATE_LIMIT = { limit: 5, windowSec: 60 * 60 };
const EMAIL_RATE_LIMIT = { limit: 3, windowSec: 24 * 60 * 60 };

export type CollectionSignupState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  | null;

const field = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

export async function submitCollectionSignupAction(
  _prev: CollectionSignupState,
  formData: FormData,
): Promise<CollectionSignupState> {
  // Honeypot: hidden from people, filled by bots. Answer as if it worked so
  // the bot learns nothing, and send nothing.
  if (field(formData, "website").trim() !== "") {
    logger.info({ event: "collection_signup.honeypot" });
    return { ok: true };
  }

  const parsed = signupSchema.safeParse({
    name: field(formData, "name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    backcountryExperience: field(formData, "backcountryExperience"),
    hasEquipment: field(formData, "hasEquipment"),
    dataExperience: field(formData, "dataExperience"),
    motivation: field(formData, "motivation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the form and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const s = parsed.data;

  const ip = await clientIp();
  const ipRate = await incrementRateLimit(`collection-signup-ip:${ip}`, IP_RATE_LIMIT);
  if (!ipRate.allowed) {
    logger.warn({ event: "collection_signup.ip_rate_limited", ip });
    return { ok: false, error: "Too many sign-ups from this network. Try again later." };
  }
  const emailRate = await incrementRateLimit(`collection-signup:${s.email}`, EMAIL_RATE_LIMIT);
  if (!emailRate.allowed) {
    logger.warn({ event: "collection_signup.rate_limited", email: s.email });
    return {
      ok: false,
      error: "We already have sign-ups from this address. We'll be in touch.",
    };
  }

  let admins: string[];
  try {
    admins = await staffEmails(["rmdig_admin"]);
  } catch (err) {
    reportError("collection_signup.admin_lookup_failed", err);
    return { ok: false, error: "Couldn't send your sign-up. Try again in a moment." };
  }
  if (admins.length === 0) {
    reportProblem("collection_signup.no_admins", "No rmdig admin to receive a volunteer sign-up");
    return { ok: false, error: "Couldn't send your sign-up. Try again in a moment." };
  }

  const params = {
    name: s.name,
    email: s.email,
    ...(s.phone ? { phone: s.phone } : {}),
    city: s.city,
    state: s.state,
    backcountryExperience: s.backcountryExperience,
    hasEquipment: s.hasEquipment === "yes",
    dataExperience: s.dataExperience,
    motivation: s.motivation,
    submittedAtIso: new Date().toISOString(),
  };
  let delivered = 0;
  for (const to of admins) {
    try {
      await sendCollectionSignupEmail(to, params);
      delivered += 1;
    } catch (err) {
      // lib/email/send has already reported it to Sentry.
      logger.error({ event: "collection_signup.admin_email_failed", to, err });
    }
  }
  if (delivered === 0) {
    return { ok: false, error: "Couldn't send your sign-up. Try again in a moment." };
  }

  logger.info({ event: "collection_signup.received", delivered });
  return { ok: true };
}
