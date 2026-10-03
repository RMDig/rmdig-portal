import { describe, expect, it } from "vitest";

import {
  audiencesOf,
  createAnnouncementSchema,
  forbiddenPhrasesIn,
  formatMountain,
  mountainLocalToDate,
  phaseOf,
  shownTo,
} from "@/lib/announcements/announcements";

describe("audiencesOf", () => {
  it("puts a user with no roles in everyone + explorer", () => {
    expect([...audiencesOf({ isStaff: false, isSar: false, isAdvertiser: false })].sort()).toEqual(["everyone", "explorer"]);
  });
  it("adds each role, and drops explorer once any role is held", () => {
    expect([...audiencesOf({ isStaff: true, isSar: true, isAdvertiser: false })].sort()).toEqual(["everyone", "sar", "staff"]);
    expect(audiencesOf({ isStaff: false, isSar: false, isAdvertiser: true }).has("explorer")).toBe(false);
  });
});

describe("shownTo", () => {
  const sar = audiencesOf({ isStaff: false, isSar: true, isAdvertiser: false });
  it("shows an announcement when any audience matches", () => {
    expect(shownTo({ audiences: ["advertiser", "sar"] }, sar)).toBe(true);
    expect(shownTo({ audiences: ["everyone"] }, sar)).toBe(true);
  });
  it("hides it otherwise", () => {
    expect(shownTo({ audiences: ["explorer", "advertiser"] }, sar)).toBe(false);
  });
});

describe("phaseOf", () => {
  const now = new Date("2026-10-04T08:00:00Z");
  const at = (iso: string) => new Date(iso);
  it("is live with no window, or inside it", () => {
    expect(phaseOf({ startsAt: null, endsAt: null, endedAt: null }, now)).toBe("live");
    expect(phaseOf({ startsAt: at("2026-10-04T07:00:00Z"), endsAt: at("2026-10-04T09:00:00Z"), endedAt: null }, now)).toBe("live");
  });
  it("is scheduled before its start", () => {
    expect(phaseOf({ startsAt: at("2026-10-04T09:00:00Z"), endsAt: null, endedAt: null }, now)).toBe("scheduled");
  });
  it("is over at its end, or once ended by hand", () => {
    expect(phaseOf({ startsAt: null, endsAt: now, endedAt: null }, now)).toBe("over");
    expect(phaseOf({ startsAt: null, endsAt: null, endedAt: at("2026-10-04T07:59:00Z") }, now)).toBe("over");
  });
});

describe("Mountain-time input", () => {
  it("converts summer (MDT, UTC-6) and winter (MST, UTC-7) wall-clock times", () => {
    expect(mountainLocalToDate("2026-10-04T02:00").toISOString()).toBe("2026-10-04T08:00:00.000Z");
    expect(mountainLocalToDate("2026-12-20T02:00").toISOString()).toBe("2026-12-20T09:00:00.000Z");
  });
  it("formats back in Mountain time", () => {
    expect(formatMountain(new Date("2026-10-04T08:00:00Z"))).toMatch(/Sun, Oct 4, 2:00\s?AM MDT/);
  });
  it("rejects anything that isn't a datetime-local value", () => {
    expect(() => mountainLocalToDate("tomorrow")).toThrow();
  });
});

describe("forbiddenPhrasesIn", () => {
  it("finds the public claims we can't make, case-insensitively", () => {
    expect(forbiddenPhrasesIn("Alerts are Real-Time and 24/7")).toEqual(["real-time", "24/7"]);
    expect(forbiddenPhrasesIn("The portal will be down Saturday 02:00–02:30 MT.")).toEqual([]);
  });
});

describe("createAnnouncementSchema", () => {
  const base = { message: "Portal maintenance Saturday night.", severity: "maintenance", audiences: ["everyone"] };

  it("accepts a minimal announcement and converts times", () => {
    const v = createAnnouncementSchema.parse({ ...base, startsAt: "2026-10-04T02:00", endsAt: "" });
    expect(v.startsAt?.toISOString()).toBe("2026-10-04T08:00:00.000Z");
    expect(v.endsAt).toBeUndefined();
  });

  it("rejects an empty or overlong message, a forbidden claim, no audience, or an end before the start", () => {
    for (const bad of [
      { ...base, message: "  " },
      { ...base, message: "x".repeat(301) },
      { ...base, message: "We are always up." },
      { ...base, audiences: [] },
      { ...base, audiences: ["everybody"] },
      { ...base, severity: "urgent" },
      { ...base, startsAt: "2026-10-04T03:00", endsAt: "2026-10-04T02:00" },
    ]) {
      expect(createAnnouncementSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
