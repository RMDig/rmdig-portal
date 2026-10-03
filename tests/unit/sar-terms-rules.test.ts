import { describe, expect, it } from "vitest";

import { requiresReacceptance, termsSha256 } from "@/lib/sar/terms";
import { CAPABILITIES, capabilitySettings, termsDraftSchema, termsWordingProblems } from "@/lib/sar/terms-rules";

// Team terms (docs/plans/33; AvServ plan 41; AvApp plan 47 §2.13).

describe("termsWordingProblems", () => {
  it("passes plain terms", () => {
    expect(
      termsWordingProblems(
        "We are volunteers. If an alert reaches us, we decide whether and how to act. Call 911 first in an emergency.",
      ),
    ).toEqual([]);
  });

  it.each([
    ["We are available to help anyone in the county.", "availability"],
    ["Our team responds within 30 minutes.", "response time"],
    ["We cover all of Summit County.", "coverage"],
    ["Hours: 8am to 6pm daily.", "hours"],
    ["Members are on-call every weekend.", "on call"],
    ["We monitor alerts.", "monitoring"],
    ["We will respond to every alert.", "duty to respond"],
    ["We guarantee a reply.", "guarantee"],
    ["Help is there 24/7.", "forbidden claim"],
  ])("blocks %j (%s)", (body, rule) => {
    expect(termsWordingProblems(body).map((p) => p.rule)).toContain(rule);
  });
});

describe("termsDraftSchema", () => {
  it("needs a body and at least one offered service", () => {
    expect(termsDraftSchema.safeParse({ body: "x", capabilities: ["checkout_alerts"] }).success).toBe(true);
    expect(termsDraftSchema.safeParse({ body: "   ", capabilities: ["checkout_alerts"] }).success).toBe(false);
    expect(termsDraftSchema.safeParse({ body: "x", capabilities: [] }).success).toBe(false);
    expect(termsDraftSchema.safeParse({ body: "x", capabilities: ["incident_alerts"] }).success).toBe(false);
  });
});

describe("capabilitySettings", () => {
  it("gives message services the portal channel and the rest none", () => {
    expect(capabilitySettings(["send_help_area", "area_map", "checkout_alerts"])).toEqual([
      { name: "checkout_alerts", channels: ["portal"] },
      { name: "send_help_area", channels: ["portal"] },
      { name: "area_map", channels: [] },
    ]);
  });

  it("doesn't offer Incident Detection alerts yet", () => {
    expect(CAPABILITIES.find((c) => c.name === "incident_alerts")?.offered).toBe(false);
  });
});

describe("termsSha256", () => {
  it("hashes the exact UTF-8 bytes, so whitespace and accents matter", () => {
    expect(termsSha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(termsSha256("abc\n")).not.toBe(termsSha256("abc"));
    expect(termsSha256("café")).not.toBe(termsSha256("café"));
  });
});

describe("requiresReacceptance", () => {
  const a = { name: "checkout_alerts" as const, channels: ["portal" as const] };
  const b = { name: "send_help_added" as const, channels: ["portal" as const] };

  it("is required for the first version, a changed text, or an added service or channel", () => {
    expect(requiresReacceptance(null, { body: "t", capabilities: [a] })).toBe(true);
    expect(requiresReacceptance({ body: "t", capabilities: [a] }, { body: "t2", capabilities: [a] })).toBe(true);
    expect(requiresReacceptance({ body: "t", capabilities: [a] }, { body: "t", capabilities: [a, b] })).toBe(true);
    expect(
      requiresReacceptance(
        { body: "t", capabilities: [a] },
        { body: "t", capabilities: [{ name: "checkout_alerts", channels: ["portal", "email"] }] },
      ),
    ).toBe(true);
  });

  it("isn't required when the text is identical and a service was only removed", () => {
    expect(requiresReacceptance({ body: "t", capabilities: [a, b] }, { body: "t", capabilities: [a] })).toBe(false);
  });
});
