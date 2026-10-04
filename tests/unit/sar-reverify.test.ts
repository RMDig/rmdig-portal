import { describe, expect, it } from "vitest";

import { patrolAdminsNotified, reminderStage } from "@/lib/sar/reverify";

const NOW = new Date("2026-10-04T15:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe("reminderStage", () => {
  it("is nothing more than 30 days out", () => {
    expect(reminderStage(inDays(31), NOW)).toBeNull();
    expect(reminderStage(inDays(365), NOW)).toBeNull();
  });
  it("steps through 30 days, 7 days and lapsed at the boundaries", () => {
    expect(reminderStage(inDays(30), NOW)).toBe("due_30");
    expect(reminderStage(inDays(8), NOW)).toBe("due_30");
    expect(reminderStage(inDays(7), NOW)).toBe("due_7");
    expect(reminderStage(inDays(0.5), NOW)).toBe("due_7");
    expect(reminderStage(inDays(0), NOW)).toBe("lapsed");
    expect(reminderStage(inDays(-40), NOW)).toBe("lapsed");
  });
  it("tells the patrol's admins at the first notice and the lapse, staff every time", () => {
    expect([patrolAdminsNotified("due_30"), patrolAdminsNotified("due_7"), patrolAdminsNotified("lapsed")]).toEqual([true, false, true]);
  });
});
