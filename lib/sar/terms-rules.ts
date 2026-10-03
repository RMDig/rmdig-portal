import { z } from "zod";

import { FORBIDDEN_PUBLIC_PHRASES } from "../legal/compliance-copy";

// Team terms rules (docs/plans/33; AvServ plan 41 §2.6; AvApp plan 47 §2.13).
// Client-safe (no node imports): the editor runs the wording check as the
// author types, and the server actions run the same checks before saving,
// submitting or publishing.

export type CapabilityName =
  | "checkout_alerts"
  | "send_help_added"
  | "send_help_area"
  | "named_to_contacts"
  | "area_map"
  | "incident_alerts";

export interface CapabilityInfo {
  name: CapabilityName;
  /** Plain words, as the app lists them on the terms screen (plan 47 §2.13). */
  label: string;
  /** Delivers alerts, so it carries channels. */
  message: boolean;
  /** Offered in the editor now. incident_alerts waits for Incident Detection. */
  offered: boolean;
  note?: string;
}

export const CAPABILITIES: readonly CapabilityInfo[] = [
  { name: "checkout_alerts", label: "Missed check-ins from users who added the team", message: true, offered: true },
  { name: "send_help_added", label: "Send Help from users who added the team", message: true, offered: true },
  {
    name: "send_help_area",
    label: "“Also send help” from users in the team's area who didn't add it",
    message: true,
    offered: true,
  },
  {
    name: "named_to_contacts",
    label: "Being named in a contact's alert when the team wasn't alerted",
    message: false,
    offered: true,
  },
  {
    name: "area_map",
    label: "The anonymised area map on the portal",
    message: false,
    offered: true,
    note: "Stays off until counsel approves it.",
  },
  {
    name: "incident_alerts",
    label: "Incident Detection alerts",
    message: true,
    offered: false,
    note: "Not available yet.",
  },
];

/** Channels per capability. Only the portal channel exists so far (it is
 *  every team's primary channel); email, webhook and SMS come with channel
 *  verification, SMS after the A2P re-filing. Non-message capabilities carry
 *  no channels (AvServ sar_team_sync.md). */
export function capabilitySettings(names: CapabilityName[]) {
  return CAPABILITIES.filter((c) => names.includes(c.name)).map((c) => ({
    name: c.name,
    channels: c.message ? (["portal"] as Array<"portal">) : [],
  }));
}

const OFFERED = CAPABILITIES.filter((c) => c.offered).map((c) => c.name) as [CapabilityName, ...CapabilityName[]];

export const termsDraftSchema = z.object({
  body: z
    .string()
    .min(1, "Write your team's terms.")
    .max(20_000, "Keep the terms under 20,000 characters.")
    .refine((b) => b.trim().length > 0, "Write your team's terms."),
  capabilities: z.array(z.enum(OFFERED)).min(1, "Choose at least one service your team provides."),
});

export interface WordingProblem {
  rule: string;
  match: string;
}

// What team terms must never say (AvServ plan 41 §0; CLAUDE.md §0): anything
// about availability, hours, coverage or response times, any monitoring or
// on-call claim, any duty or promise to respond, and the forbidden public
// claims. Deliberately broad: a team can always rephrase, and a false sense
// of being watched is the failure we're preventing.
const RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "availability", re: /\bavailab(le|ility)\b/gi },
  { rule: "hours", re: /\b(hours?|around the clock|day or night|nights? and weekends?|weekends?)\b/gi },
  { rule: "times of day", re: /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/gi },
  { rule: "coverage", re: /\b(coverage|covers?|covered|covering)\b/gi },
  {
    rule: "response time",
    re: /\b(respond|response|reach|arrive|dispatch|deploy)\w*\b[^.]{0,40}\b(within|in under|in less than|under)\b|\bresponse times?\b/gi,
  },
  { rule: "minutes", re: /\b\d+\s*(minutes?|mins?|hrs?)\b/gi },
  { rule: "monitoring", re: /\bmonitor\w*\b|\bwatch(ing|es|ed)?\s+(over|out for)\b|\bkeep an eye\b/gi },
  { rule: "on call", re: /\bon[- ]call\b|\bstandby\b|\bstand by\b/gi },
  { rule: "duty to respond", re: /\b(will|shall|must|always|promise to|guarantee to|commit to)\s+(respond|rescue|come|dispatch|deploy|send)\b/gi },
  { rule: "guarantee", re: /\bguarantee\w*\b|\bensure[sd]?\b/gi },
];

/** Every wording problem in a terms body. Empty means it may be submitted. */
export function termsWordingProblems(body: string): WordingProblem[] {
  const problems: WordingProblem[] = [];
  for (const { rule, re } of RULES) {
    for (const m of body.matchAll(re)) problems.push({ rule, match: m[0] });
  }
  const lower = body.toLowerCase();
  for (const p of FORBIDDEN_PUBLIC_PHRASES) {
    if (lower.includes(p)) problems.push({ rule: "forbidden claim", match: p });
  }
  return problems;
}
