import { describe, expect, it, vi } from "vitest";

// Stub the db client so importing the schema (which pulls in lib/db for the enum)
// doesn't construct a real postgres client.
vi.mock("@/lib/db", () => ({ db: {} }));

import { createCreativeSchema } from "@/lib/advertiser/creative-schema";

const base = {
  campaignName: "Spring 2026",
  slot: "post_checkin",
  headline: "Stay found out there",
  body: "Beacons, probes, and shovels — fitted by people who ski the same lines.",
  altText: "Summit Gear: avalanche safety equipment.",
};

describe("createCreativeSchema", () => {
  it("accepts a valid draft", () => {
    const r = createCreativeSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.slot).toBe("post_checkin");
      expect(r.data.clickUrl).toBeUndefined();
    }
  });

  it("accepts the post_checkout slot", () => {
    expect(createCreativeSchema.safeParse({ ...base, slot: "post_checkout" }).success).toBe(true);
  });

  it("rejects the reserved loading_idle slot (not buyable yet)", () => {
    expect(createCreativeSchema.safeParse({ ...base, slot: "loading_idle" }).success).toBe(false);
  });

  it("rejects an unknown slot", () => {
    expect(createCreativeSchema.safeParse({ ...base, slot: "post_signin" }).success).toBe(false);
  });

  it("requires a headline", () => {
    expect(createCreativeSchema.safeParse({ ...base, headline: "" }).success).toBe(false);
  });

  it("rejects an over-long headline", () => {
    expect(createCreativeSchema.safeParse({ ...base, headline: "x".repeat(81) }).success).toBe(
      false,
    );
  });

  it("requires alt text", () => {
    expect(createCreativeSchema.safeParse({ ...base, altText: "" }).success).toBe(false);
  });

  it("accepts an https tap-through link", () => {
    const r = createCreativeSchema.safeParse({ ...base, clickUrl: "https://summitgear.com/beacons" });
    expect(r.success && r.data.clickUrl).toBe("https://summitgear.com/beacons");
  });

  it("rejects a non-https tap-through link", () => {
    expect(createCreativeSchema.safeParse({ ...base, clickUrl: "http://insecure.com" }).success).toBe(
      false,
    );
  });

  it("collapses a blank tap-through link to undefined", () => {
    const r = createCreativeSchema.safeParse({ ...base, clickUrl: "   " });
    expect(r.success && r.data.clickUrl).toBeUndefined();
  });
});
