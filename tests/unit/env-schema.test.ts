import { describe, expect, it } from "vitest";

import { Env } from "@/lib/env";

// lib/env's schema: production can't boot without NEXTAUTH_URL (every emailed
// link is built from it; unset, they'd point at localhost), and the feature
// flags default off.

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  NEXTAUTH_SECRET: "a".repeat(64),
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};

describe("Env schema", () => {
  it("requires NEXTAUTH_URL in production", () => {
    const r = Env.safeParse({ ...base, VERCEL_ENV: "production" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.NEXTAUTH_URL).toEqual([expect.stringMatching(/production/)]);
    expect(Env.safeParse({ ...base, VERCEL_ENV: "production", NEXTAUTH_URL: "https://rmdig.ai" }).success).toBe(true);
  });

  it("leaves it optional on previews and locally (Auth.js detects the URL)", () => {
    expect(Env.safeParse({ ...base, VERCEL_ENV: "preview" }).success).toBe(true);
    expect(Env.safeParse(base).success).toBe(true);
  });

  it("defaults the unfinished surfaces off, and accepts only on/off", () => {
    const r = Env.parse(base);
    expect(r.FEATURE_ADVERTISER_PORTAL).toBe("off");
    expect(r.FEATURE_RESTRICTION_REVIEW).toBe("off");
    expect(Env.safeParse({ ...base, FEATURE_ADVERTISER_PORTAL: "true" }).success).toBe(false);
  });
});
