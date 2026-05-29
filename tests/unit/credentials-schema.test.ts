import { describe, expect, it } from "vitest";
import { z } from "zod";

// Inline-redefine the credentials schema. Pulling it from lib/auth would drag
// in the full Auth.js + db client + env at import time — tests stay unit-pure.
// When this schema diverges from the one in lib/auth, both should be updated
// or extracted to a shared module.
const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(12).max(200),
});

describe("credentials schema (sign-in input)", () => {
  it("accepts a well-formed email and any non-empty password", () => {
    const r = credentialsSchema.safeParse({ email: "a@b.com", password: "x" });
    expect(r.success).toBe(true);
  });

  it("lowercases the email", () => {
    const r = credentialsSchema.parse({ email: "DENNYS@RMDIG.AI", password: "x" });
    expect(r.email).toBe("dennys@rmdig.ai");
  });

  it("rejects an empty password", () => {
    const r = credentialsSchema.safeParse({ email: "a@b.com", password: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const r = credentialsSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(r.success).toBe(false);
  });
});

describe("sign-up schema", () => {
  it("requires at least 12 characters", () => {
    const r = signUpSchema.safeParse({ email: "a@b.com", password: "shortpass" });
    expect(r.success).toBe(false);
  });

  it("accepts a 12-char password", () => {
    const r = signUpSchema.safeParse({ email: "a@b.com", password: "abcdefghijkl" });
    expect(r.success).toBe(true);
  });

  it("rejects passwords over 200 chars (defense-in-depth against bcrypt edge cases)", () => {
    const r = signUpSchema.safeParse({ email: "a@b.com", password: "x".repeat(201) });
    expect(r.success).toBe(false);
  });
});
