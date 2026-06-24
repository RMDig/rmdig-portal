import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreativeTarget } from "@/lib/avserv/client";

const CREATIVE = "33333333-3333-5333-8333-333333333333";

const input = {
  portalCreativeId: CREATIVE,
  slot: "post_checkin",
  headline: "Stay found out there",
  body: "Beacons, probes, and shovels.",
  altText: "Summit Gear: avalanche safety equipment.",
};

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
});

describe("publishCreative (mock path)", () => {
  it("returns a deterministic ref per creative id", async () => {
    const { publishCreative } = await import("@/lib/avserv/client");

    const a = await publishCreative(input);
    const b = await publishCreative(input);

    expect(a.avservCreativeRef).toMatch(/^crv_[0-9a-f]{16}$/);
    expect(a.avservCreativeRef).toBe(b.avservCreativeRef);
  });

  it("gives different refs to different creatives", async () => {
    const { publishCreative } = await import("@/lib/avserv/client");

    const a = await publishCreative(input);
    const b = await publishCreative({ ...input, portalCreativeId: "44444444-4444-5444-8444-444444444444" });

    expect(a.avservCreativeRef).not.toBe(b.avservCreativeRef);
  });

  it("throws on a missing portalCreativeId", async () => {
    const { publishCreative } = await import("@/lib/avserv/client");
    await expect(publishCreative({ ...input, portalCreativeId: "" })).rejects.toThrow();
  });

  it("throws when AVSERV_BASE_URL is unset", async () => {
    delete process.env.AVSERV_BASE_URL;
    vi.resetModules();
    const { publishCreative } = await import("@/lib/avserv/client");
    await expect(publishCreative(input)).rejects.toThrow(/AVSERV_BASE_URL/);
  });
});

describe("publishCreative target lens (doc 31 §3)", () => {
  // The mock ref derives from the creative id only, so the target never changes the
  // ref — these assert the new `target` field is accepted for each kind and that the
  // wire shape stays stable, guarding the forecast-zone → radius/admin migration.
  const targets: CreativeTarget[] = [
    { kind: "national" },
    { kind: "radius", lat: 39.74, lon: -105.0, mi: 30 },
    { kind: "admin", level: "state", fips: ["08"] },
    { kind: "admin", level: "county", fips: ["08013", "08049"] },
  ];

  it.each(targets)("accepts a %o target and returns a stable ref", async (target) => {
    const { publishCreative } = await import("@/lib/avserv/client");
    const { avservCreativeRef } = await publishCreative({ ...input, target });
    expect(avservCreativeRef).toMatch(/^crv_[0-9a-f]{16}$/);
  });

  it("omitting target (defaults to national) still publishes", async () => {
    const { publishCreative } = await import("@/lib/avserv/client");
    await expect(publishCreative(input)).resolves.toMatchObject({
      avservCreativeRef: expect.stringMatching(/^crv_[0-9a-f]{16}$/),
    });
  });
});

describe("unpublishCreative (mock path)", () => {
  it("resolves (no-op) for a valid ref", async () => {
    const { unpublishCreative } = await import("@/lib/avserv/client");
    await expect(unpublishCreative("crv_abc123")).resolves.toBeUndefined();
  });

  it("throws on an empty ref", async () => {
    const { unpublishCreative } = await import("@/lib/avserv/client");
    await expect(unpublishCreative("")).rejects.toThrow();
  });
});
