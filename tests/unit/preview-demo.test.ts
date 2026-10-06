import { describe, expect, it } from "vitest";

import { DEMO, DEMO_TERMS, demoIntakeMessages } from "@/lib/preview-demo";
import { IntakePayload } from "@/lib/sar/intake";
import { termsWordingProblems } from "@/lib/sar/terms-rules";

// The preview demo world must be valid by the same rules real data meets, so
// what a preview shows is what production would.
const NOW = new Date("2026-10-06T18:00:00Z");

describe("preview demo world", () => {
  it("delivers alerts that pass the real intake schema, keyed <subject>:<teamId>", () => {
    for (const m of demoIntakeMessages(NOW)) {
      expect(IntakePayload.safeParse(m.payload).success).toBe(true);
      expect(m.payload.teamId).toBe(DEMO.team);
      expect(m.payload.alertId).toMatch(new RegExp(`^demo-[a-z]+-\\d:${DEMO.team}$`));
    }
  });

  it("shows each alert state: an open one delivered twice, a resolved one, a retracted area Send Help", () => {
    const ms = demoIntakeMessages(NOW).map((m) => m.payload);
    const byAlert = (suffix: string) => ms.filter((p) => p.alertId.startsWith(suffix));
    expect(byAlert("demo-checkout-1").map((p) => p.node)).toEqual(["avserv-2", "avserv-3"]);
    expect(byAlert("demo-help-1").map((p) => p.kind)).toEqual(["send_help", "all_clear"]);
    const area = byAlert("demo-help-2");
    expect(area.map((p) => p.kind)).toEqual(["send_help", "disregard"]);
    expect(area[0]!.capability).toBe("send_help_area");
  });

  it("drops the position of the alert that ended two days ago, as retention does after 24 hours", () => {
    const resolved = demoIntakeMessages(NOW).find((m) => m.payload.kind === "send_help" && m.payload.alertId.startsWith("demo-help-1"))!;
    expect((resolved.payload as Extract<IntakePayload, { kind: "send_help" }>).alert.lastFix).toBeNull();
  });

  it("uses team terms that pass the publishing wording check and say they're a sample", () => {
    expect(termsWordingProblems(DEMO_TERMS)).toEqual([]);
    expect(DEMO_TERMS).toMatch(/not a real search and rescue team/);
  });
});
