import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it, vi } from "vitest";

// Email addresses never reach the logs in plaintext; the same address always
// gives the same pseudonym so one person's sign-up can still be followed.

vi.mock("@/lib/env", () => ({ env: { NODE_ENV: "test", NEXTAUTH_SECRET: "a".repeat(64) } }));

import { pseudonymizeEmail, pseudonymizeIp, redactOptions } from "@/lib/logger";

function capture(): { log: pino.Logger; lines: () => Array<Record<string, unknown>> } {
  const out: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      out.push(String(chunk));
      done();
    },
  });
  return { log: pino({ redact: redactOptions }, stream), lines: () => out.map((l) => JSON.parse(l)) };
}

describe("log redaction", () => {
  it("pseudonymizes email and recipient fields, case- and space-insensitively", () => {
    const { log, lines } = capture();
    log.info({ event: "signup.duplicate", email: "Pat@Example.org" });
    log.info({ event: "email.verification.sent", to: " pat@example.org" });
    log.info({ event: "x", user: { email: "pat@example.org" } });
    const [a, b, c] = lines();
    expect(a!.email).toMatch(/^e:[0-9a-f]{16}$/);
    expect(b!.to).toBe(a!.email);
    expect((c!.user as { email: string }).email).toBe(a!.email);
    expect(JSON.stringify(lines())).not.toContain("example.org");
  });

  it("gives different addresses different pseudonyms, and maps recipient lists", () => {
    expect(pseudonymizeEmail("a@example.org")).not.toBe(pseudonymizeEmail("b@example.org"));
    expect(pseudonymizeEmail(["a@example.org"])).toEqual([pseudonymizeEmail("a@example.org")]);
    expect(pseudonymizeEmail({ nested: "a@example.org" })).toBe("[REDACTED]");
  });

  it("still redacts secrets outright", () => {
    const { log, lines } = capture();
    log.info({ password: "hunter2hunter2", token: "t" });
    expect(lines()[0]).toMatchObject({ password: "[REDACTED]", token: "[REDACTED]" });
  });

  it("pseudonymizes client IPs, consistently and separately from emails (plan 36 H6)", () => {
    const { log, lines } = capture();
    log.info({ event: "signup.ip_rate_limited", ip: "203.0.113.7" });
    log.info({ event: "x", req: { ip: "203.0.113.7" } });
    const [a, b] = lines();
    expect(a!.ip).toMatch(/^i:[0-9a-f]{16}$/);
    expect((b!.req as { ip: string }).ip).toBe(a!.ip);
    expect(JSON.stringify(lines())).not.toContain("203.0.113.7");
    expect(pseudonymizeIp("203.0.113.7")).not.toBe(pseudonymizeIp("203.0.113.8"));
  });

  it("redacts phone numbers outright", () => {
    const { log, lines } = capture();
    log.info({ event: "x", phone: "+17205550123", org: { contactPhone: "+17205550123", phoneE164: "+17205550123" } });
    expect(JSON.stringify(lines())).not.toContain("5550123");
  });
});
