import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rlDeniedKeys: [] as string[],
  rlSeenKeys: [] as string[],
  admins: ["admin-a@rmdig.ai", "admin-b@rmdig.ai"] as string[],
  adminLookupFails: false,
  failingRecipients: [] as string[],
  send: vi.fn(),
  reportError: vi.fn(),
  reportProblem: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/staff-recipients", () => ({
  staffEmails: (roles?: string[]) => {
    if (h.adminLookupFails) return Promise.reject(new Error("db down"));
    expect(roles).toEqual(["rmdig_admin"]);
    return Promise.resolve(h.admins);
  },
}));
vi.mock("@/lib/email/send", () => ({
  sendCollectionSignupEmail: (to: string, params: unknown) => {
    h.send(to, params);
    return h.failingRecipients.includes(to) ? Promise.reject(new Error("resend down")) : Promise.resolve();
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlSeenKeys.push(key);
    return Promise.resolve({
      allowed: !h.rlDeniedKeys.some((denied) => key.startsWith(denied)),
      attempts: 1,
      resetAt: new Date(),
    });
  },
}));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError, reportProblem: h.reportProblem }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));

import { submitCollectionSignupAction } from "@/app/(public)/collection_signup/actions";

const VALID = {
  name: "Avery Lane",
  email: "Avery@Example.com",
  phone: "",
  city: "Frisco",
  state: "CO",
  backcountryExperience: "AIARE 1, four seasons touring",
  hasEquipment: "yes",
  dataExperience: "None",
  motivation: "Give back",
  website: "",
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rlDeniedKeys = [];
  h.rlSeenKeys = [];
  h.admins = ["admin-a@rmdig.ai", "admin-b@rmdig.ai"];
  h.adminLookupFails = false;
  h.failingRecipients = [];
});

describe("submitCollectionSignupAction", () => {
  it("emails every rmdig admin the normalized sign-up", async () => {
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res).toEqual({ ok: true });
    expect(h.send).toHaveBeenCalledTimes(2);
    const [to, params] = h.send.mock.calls[0] as [string, Record<string, unknown>];
    expect(to).toBe("admin-a@rmdig.ai");
    expect(params).toMatchObject({ name: "Avery Lane", email: "avery@example.com", hasEquipment: true });
    // A blank optional phone is left out, not sent as "".
    expect(params).not.toHaveProperty("phone");
    expect(h.rlSeenKeys).toEqual(["collection-signup-ip:203.0.113.7", "collection-signup:avery@example.com"]);
  });

  it("answers a honeypot fill as success and sends nothing", async () => {
    const res = await submitCollectionSignupAction(null, form({ ...VALID, website: "http://spam.example" }));
    expect(res).toEqual({ ok: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rlSeenKeys).toHaveLength(0);
  });

  it("rejects missing and malformed fields with field errors", async () => {
    const res = await submitCollectionSignupAction(
      null,
      form({ ...VALID, email: "nope", city: "  ", hasEquipment: "maybe", phone: "call me", name: "Avery\nBcc: x" }),
    );
    expect(res?.ok).toBe(false);
    if (res?.ok === false) {
      expect(Object.keys(res.fieldErrors ?? {}).sort()).toEqual(["city", "email", "hasEquipment", "name", "phone"]);
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it("stops at the per-IP limit before the per-address one", async () => {
    h.rlDeniedKeys = ["collection-signup-ip:"];
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(h.rlSeenKeys).toEqual(["collection-signup-ip:203.0.113.7"]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("stops at the per-address limit", async () => {
    h.rlDeniedKeys = ["collection-signup:"];
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res?.ok).toBe(false);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails loud when there is no admin to receive it", async () => {
    h.admins = [];
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't send/) });
    expect(h.reportProblem).toHaveBeenCalledWith("collection_signup.no_admins", expect.any(String));
  });

  it("fails loud when the admin lookup throws", async () => {
    h.adminLookupFails = true;
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res?.ok).toBe(false);
    expect(h.reportError).toHaveBeenCalledWith("collection_signup.admin_lookup_failed", expect.any(Error));
  });

  it("tells the applicant to retry when no email went out", async () => {
    h.failingRecipients = ["admin-a@rmdig.ai", "admin-b@rmdig.ai"];
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't send/) });
    expect(h.log.error).toHaveBeenCalledTimes(2);
  });

  it("succeeds when at least one admin got it, logging the failed one", async () => {
    h.failingRecipients = ["admin-a@rmdig.ai"];
    const res = await submitCollectionSignupAction(null, form(VALID));
    expect(res).toEqual({ ok: true });
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "collection_signup.admin_email_failed", to: "admin-a@rmdig.ai" }),
    );
  });
});
