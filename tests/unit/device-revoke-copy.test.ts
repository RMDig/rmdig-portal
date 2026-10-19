import { describe, expect, it } from "vitest";

import { REVOKE_COPY } from "@/app/(portal)/settings/devices/revoke-copy";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";

// The revoke copy promises no more than the phone and AvServ do (AvApp plan 54
// §7.1a; device_revoke.md rev 2), and carries no claim words (doc 16 §6.2).

const all = (o: unknown): string[] =>
  typeof o === "string"
    ? [o]
    : typeof o === "function"
      ? [(o as (t: string | null) => string)(null), (o as (t: string | null) => string)("Mon, Oct 19, 4:30 PM MDT")]
      : Object.values(o as object).flatMap(all);
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

  it("names the due-back time when AvServ sends one, as the phone does", () => {
    expect(REVOKE_COPY.liveCheckout("Mon, Oct 19, 4:30 PM MDT")).toMatch(/^This phone has a check-out due back at Mon, Oct 19, 4:30 PM MDT\./);
    expect(REVOKE_COPY.liveCheckout(null)).toMatch(/^This phone has a check-out under way\./);
  });

  it("warns that field data is erased only on a full revoke, and keeps it locked on a limited one", () => {
    expect(REVOKE_COPY.fieldData.full).toBe("Unsynced observations and photos on that phone will be erased.");
    expect(REVOKE_COPY.fieldData.limited).toMatch(/kept, locked/);
    expect(REVOKE_COPY.fieldData.limited).not.toMatch(/eras/i);
  });

  it("says erased nowhere but the full-revoke line, never wiped, and no forbidden claim phrase", () => {
    const rest = text.replace(REVOKE_COPY.fieldData.full, "");
    expect(rest).not.toMatch(/\b(wipe|wiped|erase|erased|secure|guarantee)/i);
    expect(text).not.toMatch(/\bwipe/i);
    for (const phrase of FORBIDDEN_PUBLIC_PHRASES) {
      expect(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i").test(text), phrase).toBe(false);
    }
  });

  it("has no word for duress (plan 36 rule 3)", () => {
    expect(text).not.toMatch(/duress|second pin/i);
  });
});
