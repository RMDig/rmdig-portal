import { beforeEach, describe, expect, it, vi } from "vitest";

// A drill team's emails are marked as drills where people see them first,
// the subject line (plan 37 DR2, §4.7); a real team's never are.

const h = vi.hoisted(() => ({
  env: { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "noreply@rmdig.ai", VERCEL_ENV: "production" } as Record<string, string | undefined>,
  send: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("../../lib/env", () => ({ env: h.env }));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send };
  },
}));

import { sendDrillLoginEmail, sendSarAlertNotifyEmail, sendSarAreaChangedEmail } from "@/lib/email/send";

const subject = () => (h.send.mock.calls.at(-1)![0] as { subject: string }).subject;
const alert = { teamName: "AvAI Drill Team", kind: "overdue" as const, fromAreaUser: false, alertsUrl: "https://rmdig.ai/sar/o/alerts" };
const area = { orgName: "AvAI Drill Team", editorEmail: "ops+drill1@rmdig.ai", fromAreaKm2: 3.1, toAreaKm2: 3.2, orgUrl: "https://rmdig.ai/admin/sar-drill" };

beforeEach(() => {
  vi.clearAllMocks();
  h.send.mockResolvedValue({ data: { id: "msg_1" }, error: null });
});

describe("drill email subjects", () => {
  it("sends a new drill login its own [DRILL] set-password email, never one that reads as a reset", async () => {
    await sendDrillLoginEmail("ops+drill1@rmdig.ai", { teamName: "AvAI Drill Team", setPasswordUrl: "https://app.rmdig.ai/reset-password?token=t" });
    const sent = h.send.mock.calls.at(-1)![0] as { subject: string; html: string };
    expect(sent.subject).toBe("[DRILL] Set your password: AvAI Drill Team");
    expect(sent.html).toContain("https://app.rmdig.ai/reset-password?token=t");
    expect(sent.html).toContain("not a real search and rescue team");
    expect(sent.html).not.toContain("We received a request");
  });

  it("puts [DRILL] first on a drill team's alert email, and never on a real one", async () => {
    await sendSarAlertNotifyEmail("ops+drill1@rmdig.ai", { ...alert, drill: true });
    expect(subject()).toBe("[DRILL] AvAI alert for AvAI Drill Team: missed check-in");
    await sendSarAlertNotifyEmail("lead@sar.org", { ...alert, teamName: "Summit SAR" });
    expect(subject()).toBe("AvAI alert for Summit SAR: missed check-in");
  });

  it("says (drill) on a drill team's area-changed email", async () => {
    await sendSarAreaChangedEmail("op@rmdig.ai", { ...area, drill: true });
    expect(subject()).toBe("SAR team changed its service area: AvAI Drill Team (drill)");
    await sendSarAreaChangedEmail("op@rmdig.ai", { ...area, orgName: "Summit SAR" });
    expect(subject()).toBe("SAR team changed its service area: Summit SAR");
  });
});
