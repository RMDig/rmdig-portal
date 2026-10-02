import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException }));

import { classifyAgreementError, reportAgreementFailure } from "@/lib/agreement/errors";
import { AgreementError } from "@/lib/avserv/agreement-types";

// docs/plans/31 §5: every AvServ answer lands in exactly one user-visible class.

const err = (status: number | undefined, code?: string, extra: { detail?: string; viaFailover?: boolean } = {}) =>
  new AgreementError("x", { status, code, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyAgreementError", () => {
  it("turns name refusals into field errors carrying AvServ's message", () => {
    expect(classifyAgreementError(err(400, "invalid_display_name", { detail: "no digits" }))).toEqual({
      kind: "field",
      field: "displayName",
      message: "no digits",
    });
    expect(classifyAgreementError(err(400, "invalid_legal_name")).field).toBe("legalName");
  });

  it.each(["agreement_capture_disabled", "agreement_not_published"])("%s means not available yet", (code) => {
    expect(classifyAgreementError(err(404, code)).kind).toBe("unavailable");
  });

  it("sends a primary account_not_found to support, but treats the failover's as lag", () => {
    expect(classifyAgreementError(err(404, "account_not_found")).kind).toBe("support");
    expect(classifyAgreementError(err(404, "account_not_found", { viaFailover: true })).kind).toBe("retry");
  });

  it.each(["agreement_hash_mismatch", "agreement_wording_mismatch", "agreement_version_retired"])(
    "%s is a stale-pin fault",
    (code) => {
      const f = classifyAgreementError(err(409, code));
      expect(f.kind).toBe("fault");
      expect(f.message).toMatch(/updated/);
    },
  );

  it.each([
    "invalid_json",
    "invalid_idempotency_key",
    "invalid_assent",
    "invalid_attestations",
    "invalid_client_ip",
    "email_not_accepted",
    "invalid_account_id",
    "attestation_declined",
    "attestation_missing",
    "identity_locked",
    "idempotency_conflict",
  ])("%s is a portal-bug fault", (code) => {
    expect(classifyAgreementError(err(400, code)).kind).toBe("fault");
  });

  it("treats 5xx and a network failure as retryable, and 401 or an unknown throw as a fault", () => {
    expect(classifyAgreementError(err(503, "agreement_capture_unavailable")).kind).toBe("retry");
    expect(classifyAgreementError(err(500, "internal")).kind).toBe("retry");
    expect(classifyAgreementError(err(undefined)).kind).toBe("retry");
    expect(classifyAgreementError(err(401)).kind).toBe("fault");
    expect(classifyAgreementError(new Error("boom")).kind).toBe("fault");
  });
});

describe("reportAgreementFailure", () => {
  it("sends faults to Sentry and logs them at error", () => {
    const e = err(409, "agreement_hash_mismatch");
    reportAgreementFailure("t", classifyAgreementError(e), e, { userId: "u1" });
    expect(h.log.error).toHaveBeenCalled();
    expect(h.captureException).toHaveBeenCalledWith(e, expect.anything());
  });

  it("logs retryable failures at warn without Sentry", () => {
    const e = err(503);
    reportAgreementFailure("t", classifyAgreementError(e), e, {});
    expect(h.log.warn).toHaveBeenCalled();
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
