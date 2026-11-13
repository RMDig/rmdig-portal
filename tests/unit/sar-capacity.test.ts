import { describe, expect, it } from "vitest";

import { capacityFieldSchema, capacityText, MAX_ACTIVE_CHECKOUTS } from "@/lib/sar/capacity";

// A team's check-out cap as typed into the form (plan 33 9.7): blank for no
// limit, else a whole number in AvServ's range (422 capacity_invalid outside).

describe("capacityFieldSchema", () => {
  it("reads blank as no limit, and a whole number in range as the cap", () => {
    expect(capacityFieldSchema.parse("")).toBeNull();
    expect(capacityFieldSchema.parse("   ")).toBeNull();
    expect(capacityFieldSchema.parse("1")).toBe(1);
    expect(capacityFieldSchema.parse(" 25 ")).toBe(25);
    expect(capacityFieldSchema.parse(String(MAX_ACTIVE_CHECKOUTS))).toBe(10_000);
  });

  it("refuses anything AvServ would: zero, over the maximum, fractions, signs, words", () => {
    for (const bad of ["0", "10001", "2.5", "-3", "+3", "1e3", "25 people", "twenty", "1,000"]) {
      const r = capacityFieldSchema.safeParse(bad);
      expect(r.success, bad).toBe(false);
    }
    expect(capacityFieldSchema.safeParse("0").error?.issues[0]?.message).toBe("Enter a number from 1 to 10,000, or leave it blank for no limit.");
    expect(capacityFieldSchema.safeParse("2.5").error?.issues[0]?.message).toBe("Enter a whole number, or leave it blank for no limit.");
  });
});

describe("capacityText", () => {
  it("says the cap plainly", () => {
    expect(capacityText(null)).toBe("No limit");
    expect(capacityText(25)).toBe("25 at once");
    expect(capacityText(10_000)).toBe("10,000 at once");
  });
});
