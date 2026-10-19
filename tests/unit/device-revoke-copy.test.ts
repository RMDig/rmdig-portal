import { describe, expect, it } from "vitest";

import { REVOKE_COPY } from "@/app/(portal)/settings/devices/revoke-copy";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";

// The revoke copy promises no more than the phone and AvServ do (AvApp plan 54
// §7.1a; device_revoke.md rev 2), and carries no claim words (doc 16 §6.2).

const all = (o: unknown): string[] => (typeof o === "string" ? [o] : Object.values(o as object).flatMap(all));
const text = all(REVOKE_COPY).join(" ");

describe("revoke copy", () => {
  it("says Send Help survives, both modes, the limits and that it can't be undone", () => {
    expect(REVOKE_COPY.sendHelpStays).toMatch(/Send Help still works/);
    expect(REVOKE_COPY.mode.limited).toMatch(/start new trips/);
    expect(REVOKE_COPY.mode.full).toBe("This phone can only send Send Help.");
    expect(REVOKE_COPY.limits).toMatch(/offline/);
    expect(REVOKE_COPY.limits).toMatch(/camera roll/);
    expect(REVOKE_COPY.permanent).toMatch(/can't be undone/);
  });

  it("never claims the phone is wiped or erased, or uses a forbidden claim phrase", () => {
    expect(text).not.toMatch(/\b(wipe|wiped|erase|erased|secure|guarantee)/i);
    for (const phrase of FORBIDDEN_PUBLIC_PHRASES) {
      expect(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i").test(text), phrase).toBe(false);
    }
  });

  it("has no word for duress (plan 36 rule 3)", () => {
    expect(text).not.toMatch(/duress|second pin/i);
  });
});
