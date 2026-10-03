import { describe, expect, it } from "vitest";

import {
  isProductionDatabaseUrl,
  PRODUCTION_DB_ENDPOINT,
  previewMigrationUrl,
  previewSafetyProblems,
  shouldDeliverEmail,
} from "@/lib/preview-guard";
import { parseSeedArgs, previewPersonas, SeedPassword } from "@/lib/preview-seed";

// Preview deployments must never reach production data, the live AvServ, or a
// real person's inbox by accident (runbook "Preview deployments").

const prodUrl = `postgresql://u:p@${PRODUCTION_DB_ENDPOINT}-pooler.c-2.us-west-2.aws.neon.tech/neondb`;
const previewUrl = "postgresql://u:p@ep-preview-branch-123-pooler.c-2.us-west-2.aws.neon.tech/neondb";
const previewDirect = "postgresql://u:p@ep-preview-branch-123.c-2.us-west-2.aws.neon.tech/neondb";

describe("isProductionDatabaseUrl", () => {
  it("matches the production endpoint, pooled or direct", () => {
    expect(isProductionDatabaseUrl(prodUrl)).toBe(true);
    expect(isProductionDatabaseUrl(prodUrl.replace("-pooler", ""))).toBe(true);
  });

  it("does not match a preview branch or a missing URL", () => {
    expect(isProductionDatabaseUrl(previewUrl)).toBe(false);
    expect(isProductionDatabaseUrl(undefined)).toBe(false);
  });
});

describe("previewSafetyProblems", () => {
  it("accepts a preview branch with the AvServ mock", () => {
    expect(previewSafetyProblems({ DATABASE_URL: previewUrl, AVSERV_BASE_URL: "mock://localhost" })).toEqual([]);
  });

  it("accepts an unset AvServ (the AvServ features then show their own errors)", () => {
    expect(previewSafetyProblems({ DATABASE_URL: previewUrl })).toEqual([]);
  });

  it("rejects the production database", () => {
    const problems = previewSafetyProblems({ DATABASE_URL: prodUrl, AVSERV_BASE_URL: "mock://localhost" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/production Neon endpoint/);
  });

  it("rejects a real AvServ", () => {
    const problems = previewSafetyProblems({
      DATABASE_URL: previewUrl,
      AVSERV_BASE_URL: "https://avserv-2.rmdig.ai",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mock:\/\/localhost/);
  });

  it("reports both problems at once", () => {
    expect(previewSafetyProblems({ DATABASE_URL: prodUrl, AVSERV_BASE_URL: "https://avserv-3.rmdig.ai" })).toHaveLength(2);
  });
});

describe("previewMigrationUrl", () => {
  it("is a no-op outside previews, including production", () => {
    expect(previewMigrationUrl({ VERCEL_ENV: "production", DATABASE_URL: prodUrl })).toBeNull();
    expect(previewMigrationUrl({ DATABASE_URL: previewUrl })).toBeNull();
  });

  it("prefers the unpooled URL on a preview", () => {
    expect(
      previewMigrationUrl({ VERCEL_ENV: "preview", DATABASE_URL: previewUrl, DATABASE_URL_UNPOOLED: previewDirect }),
    ).toBe(previewDirect);
  });

  it("falls back to DATABASE_URL when no unpooled URL is injected", () => {
    expect(previewMigrationUrl({ VERCEL_ENV: "preview", DATABASE_URL: previewUrl })).toBe(previewUrl);
  });

  it("fails the build when a preview has no database", () => {
    expect(() => previewMigrationUrl({ VERCEL_ENV: "preview" })).toThrow(/no DATABASE_URL/);
  });

  it("refuses to migrate production from a preview build", () => {
    expect(() =>
      previewMigrationUrl({ VERCEL_ENV: "preview", DATABASE_URL: previewUrl, DATABASE_URL_UNPOOLED: prodUrl }),
    ).toThrow(/Refusing to migrate/);
  });
});

describe("shouldDeliverEmail", () => {
  it("always sends outside previews", () => {
    expect(shouldDeliverEmail("production", undefined, "anyone@example.com")).toBe(true);
    expect(shouldDeliverEmail(undefined, undefined, "anyone@example.com")).toBe(true);
  });

  it("logs instead of sending on a preview with no allowlist", () => {
    expect(shouldDeliverEmail("preview", undefined, "tester@example.com")).toBe(false);
    expect(shouldDeliverEmail("preview", "", "tester@example.com")).toBe(false);
  });

  it("sends on a preview to an allowlisted address, ignoring case and spacing", () => {
    expect(shouldDeliverEmail("preview", " Tester@Example.com , other@example.com", "tester@example.com")).toBe(true);
  });

  it("logs when any recipient is not allowlisted", () => {
    expect(shouldDeliverEmail("preview", "a@example.com", ["a@example.com", "b@example.com"])).toBe(false);
    expect(shouldDeliverEmail("preview", "a@example.com", [])).toBe(false);
  });
});

describe("previewPersonas", () => {
  it("plus-tags the operator's address for each persona", () => {
    const personas = previewPersonas("Ops@Example.com");
    expect(personas.map((p) => p.email)).toEqual([
      "ops+admin@example.com",
      "ops+user@example.com",
      "ops+sar@example.com",
      "ops+advertiser@example.com",
      "ops+restricted@example.com",
    ]);
  });

  it("gives the restricted persona the tag the AvServ mock recognises", () => {
    const restricted = previewPersonas("ops@example.com").find((p) => p.tag === "restricted");
    expect(restricted?.email.split("@")[0]).toContain("+restricted");
  });

  it("rejects an address that already has a tag, or isn't an address", () => {
    expect(() => previewPersonas("ops+x@example.com")).toThrow();
    expect(() => previewPersonas("not-an-email")).toThrow();
  });
});

describe("SeedPassword", () => {
  it("requires at least 16 characters", () => {
    expect(SeedPassword.safeParse("short").success).toBe(false);
    expect(SeedPassword.safeParse("a-long-enough-pass").success).toBe(true);
  });
});

describe("parseSeedArgs", () => {
  it("takes a base address alone", () => {
    expect(parseSeedArgs(["ops@example.com"])).toEqual({ base: "ops@example.com", extraAdmins: [] });
  });

  it("collects --admin addresses, normalised and de-duplicated", () => {
    expect(
      parseSeedArgs(["ops@example.com", "--admin", "Me@Work.example", "--admin", "me@work.example"]),
    ).toEqual({ base: "ops@example.com", extraAdmins: ["me@work.example"] });
  });

  it("rejects a missing base, a dangling flag, an unknown flag or a bad address", () => {
    expect(() => parseSeedArgs([])).toThrow(/missing/);
    expect(() => parseSeedArgs(["--admin", "me@work.example"])).toThrow(/missing/);
    expect(() => parseSeedArgs(["ops@example.com", "--admin"])).toThrow(/unexpected/);
    expect(() => parseSeedArgs(["ops@example.com", "--owner", "x@y.example"])).toThrow(/unexpected/);
    expect(() => parseSeedArgs(["ops@example.com", "--admin", "nope"])).toThrow();
  });
});
