import { describe, expect, it } from "vitest";

import { checkLogPseudonymKeyConfig, logPseudonymRoot } from "@/lib/log-pseudonym-key";

// Plan 36 H6: log pseudonyms get their own key, required in production at
// build time so a missing key fails a build, never a running deployment.

const KEY = "ab".repeat(32);

describe("checkLogPseudonymKeyConfig", () => {
  it("fails a production build without the key", () => {
    const r = checkLogPseudonymKeyConfig({ VERCEL_ENV: "production" });
    expect(r.status).toBe("error");
    expect(checkLogPseudonymKeyConfig({ VERCEL_ENV: "production", LOG_PSEUDONYM_KEY: "" }).status).toBe("error");
  });

  it("accepts a 64-hex key in production", () => {
    expect(checkLogPseudonymKeyConfig({ VERCEL_ENV: "production", LOG_PSEUDONYM_KEY: KEY })).toEqual({ status: "ok" });
    expect(checkLogPseudonymKeyConfig({ VERCEL_ENV: "production", LOG_PSEUDONYM_KEY: KEY.toUpperCase() }).status).toBe("ok");
  });

  it("refuses a malformed key anywhere", () => {
    for (const bad of ["ab".repeat(31), "ab".repeat(33), "zz".repeat(32), `${KEY} `]) {
      expect(checkLogPseudonymKeyConfig({ VERCEL_ENV: "preview", LOG_PSEUDONYM_KEY: bad }).status).toBe("error");
      expect(checkLogPseudonymKeyConfig({ LOG_PSEUDONYM_KEY: bad }).status).toBe("error");
    }
  });

  it("skips outside production when unset", () => {
    expect(checkLogPseudonymKeyConfig({ VERCEL_ENV: "preview" })).toEqual({ status: "skipped" });
    expect(checkLogPseudonymKeyConfig({})).toEqual({ status: "skipped" });
  });
});

describe("logPseudonymRoot", () => {
  it("uses the key's bytes when set, NEXTAUTH_SECRET otherwise", () => {
    expect(logPseudonymRoot({ LOG_PSEUDONYM_KEY: KEY, NEXTAUTH_SECRET: "s".repeat(64) })).toEqual(Buffer.from(KEY, "hex"));
    expect(logPseudonymRoot({ NEXTAUTH_SECRET: "s".repeat(64) })).toBe("s".repeat(64));
  });
});
