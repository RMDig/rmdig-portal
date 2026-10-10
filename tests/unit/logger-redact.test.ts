import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it, vi } from "vitest";

// Email addresses never reach the logs in plaintext; the same address always
// gives the same pseudonym so one person's sign-up can still be followed.

vi.mock("@/lib/env", () => ({ env: { NODE_ENV: "test", NEXTAUTH_SECRET: "a".repeat(64) } }));

import { pseudonymizeEmail, redactOptions } from "@/lib/logger";

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
});
