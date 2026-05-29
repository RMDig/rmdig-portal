import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";

describe("bcrypt round-trip", () => {
  it("verifies the correct password", async () => {
    const hash = await bcrypt.hash("correcthorsebatterystaple", 4);
    expect(await bcrypt.compare("correcthorsebatterystaple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await bcrypt.hash("correcthorsebatterystaple", 4);
    expect(await bcrypt.compare("Tr0ub4dor&3", hash)).toBe(false);
  });

  it("produces different hashes for the same password (salt is random)", async () => {
    const a = await bcrypt.hash("samepw", 4);
    const b = await bcrypt.hash("samepw", 4);
    expect(a).not.toBe(b);
    expect(await bcrypt.compare("samepw", a)).toBe(true);
    expect(await bcrypt.compare("samepw", b)).toBe(true);
  });
});
