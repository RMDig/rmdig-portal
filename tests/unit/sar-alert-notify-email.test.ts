import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import SarAlertNotifyEmail from "@/lib/email/templates/SarAlertNotifyEmail";

// The member notice says only what is true of the alert, and never carries a
// name, location or note.
const base = { teamName: "Summit SAR", alertsUrl: "https://rmdig.ai/sar/o/alerts" };
const text = async (p: Parameters<typeof SarAlertNotifyEmail>[0]) => (await render(SarAlertNotifyEmail(p), { plainText: true })).replace(/\s+/g, " ");

describe("SarAlertNotifyEmail", () => {
  it("says the user added the team only when they did", async () => {
    expect(await text({ ...base, kind: "overdue", fromAreaUser: false })).toContain("An AvAI user who added Summit SAR to their check-out has an alert.");
    const area = await text({ ...base, kind: "send_help", fromAreaUser: true });
    expect(area).toContain("who hadn't added Summit SAR, chose to send it their Send Help");
    expect(area).not.toContain("who added");
  });

  it("calls a follow-up an update and always ends with 911", async () => {
    const t = await text({ ...base, kind: "all_clear", fromAreaUser: false });
    expect(t).toContain("has an update");
    expect(t).toContain("In an emergency, call 911.");
  });
});
