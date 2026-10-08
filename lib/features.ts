import { env } from "./env";

// Surfaces that are built but switched off until AvServ ships the endpoints
// they call (lib/env FEATURE_*). Read on the server only: a page's layout
// 404s while its feature is off, and each of its server actions refuses, so
// a stale form or a hand-made POST can't reach a dead AvServ route either.
// Compared to "on" rather than parsed, so the raw build-time env (where
// lib/env exposes process.env unvalidated) reads as off too.

export type Feature = "advertiser_portal" | "restriction_review";

export function featureEnabled(feature: Feature): boolean {
  const value = feature === "advertiser_portal" ? env.FEATURE_ADVERTISER_PORTAL : env.FEATURE_RESTRICTION_REVIEW;
  return value === "on";
}

/** The error a server action returns while its feature is off. */
export const FEATURE_OFF_ERROR = "This part of the portal isn't available yet.";
