import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/email/send on a Vercel preview logs instead of sending unless the
// recipient is on PREVIEW_EMAIL_RECIPIENTS; production always sends.

const h = vi.hoisted(() => ({
  env: { RESEND_FROM_EMAIL: "noreply@rmdig.ai" } as {
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL: string;
    VERCEL_ENV?: string;
    PREVIEW_EMAIL_RECIPIENTS?: string;
  },
  send: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("../../lib/env", () => ({ env: h.env }));
vi.mock("../../lib/logger", () => ({ logger: { info: h.info, error: h.error, warn: vi.fn() } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send };
  },
}));

import { sendSarOrgDecisionEmail, sendVerificationEmail } from "@/lib/email/send";

beforeEach(() => {
  vi.clearAllMocks();
  h.env.RESEND_API_KEY = "re_test";
  delete h.env.VERCEL_ENV;
  delete h.env.PREVIEW_EMAIL_RECIPIENTS;
  h.send.mockResolvedValue({ data: { id: "msg_1" }, error: null });
});

describe("email delivery by environment", () => {
  it("sends in production", async () => {
    h.env.VERCEL_ENV = "production";
    await sendVerificationEmail("user@example.com", "https://rmdig.ai/verify?t=x");
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "email.verification.sent", resendId: "msg_1" }),
    );
  });

  it("logs without sending on a preview, and never logs the body", async () => {
    h.env.VERCEL_ENV = "preview";
    delete h.env.RESEND_API_KEY; // log mode needs no Resend key
    await sendVerificationEmail("user@example.com", "https://preview.example/verify?t=secret");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledWith({
      event: "email.verification.preview_logged",
      to: "user@example.com",
      subject: "Verify your email",
    });
    expect(JSON.stringify(h.info.mock.calls)).not.toContain("secret");
  });

  it("sends on a preview to an allowlisted tester", async () => {
    h.env.VERCEL_ENV = "preview";
    h.env.PREVIEW_EMAIL_RECIPIENTS = "tester@example.com";
    await sendVerificationEmail("tester@example.com", "https://preview.example/verify?t=x");
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ to: "tester@example.com" }));
  });

  it("keeps per-email log fields in preview mode", async () => {
    h.env.VERCEL_ENV = "preview";
    await sendSarOrgDecisionEmail("lead@example.com", { orgName: "Test SAR", decision: "approved" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "email.sar_decision.preview_logged", decision: "approved" }),
    );
  });

  it("still fails loud when Resend rejects a send", async () => {
    h.send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    await expect(sendVerificationEmail("user@example.com", "https://rmdig.ai/verify")).rejects.toThrow(
      "Resend rejected verification email: domain not verified",
    );
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ event: "email.verification.failed" }));
  });
});
