import { beforeEach, describe, expect, it, vi } from "vitest";

// The confirm button's server action (plan 35 §1): it confirms only with the
// right address, notifies once, throttles guessing, and never acts on a
// request id.

const h = vi.hoisted(() => ({
  result: { kind: "confirmed", id: "req-1", email: "pat@example.org", confirmedAt: new Date() } as Record<string, unknown>,
  confirmCalls: [] as Array<[string, string]>,
  notify: vi.fn(),
  rlAllowed: true,
  rlKeys: [] as string[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/deletion/requests", () => ({
  confirmDeletionRequest: (token: string, email: string) => {
    h.confirmCalls.push([token, email]);
    return Promise.resolve(h.result);
  },
}));
vi.mock("@/lib/deletion/notify", () => ({ notifyDeletionConfirmed: h.notify }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() });
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { confirmDeletionAction } from "@/app/(public)/account/delete/confirm/actions";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const submit = (fields: Record<string, string>) =>
  confirmDeletionAction(null, form(fields)).catch((e: { url?: string }) => ({ redirectedTo: e.url }));

beforeEach(() => {
  vi.clearAllMocks();
  h.result = { kind: "confirmed", id: "req-1", email: "pat@example.org", confirmedAt: new Date() };
  h.confirmCalls = [];
  h.rlAllowed = true;
  h.rlKeys = [];
});

describe("confirmDeletionAction", () => {
  it("confirms, notifies once, and reloads the link's page", async () => {
    expect(await submit({ token: "tok", email: "pat@example.org" })).toEqual({ redirectedTo: "/account/delete/confirm?token=tok" });
    expect(h.confirmCalls).toEqual([["tok", "pat@example.org"]]);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("an already confirmed request reloads without notifying again", async () => {
    h.result = { kind: "already", id: "req-1" };
    expect(await submit({ token: "tok", email: "pat@example.org" })).toEqual({ redirectedTo: "/account/delete/confirm?token=tok" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("says so when the address doesn't match, and confirms nothing", async () => {
    h.result = { kind: "mismatch" };
    expect(await submit({ token: "tok", email: "x@example.org" })).toEqual({
      ok: false,
      error: expect.stringMatching(/isn't the email address/),
    });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("explains an invalid or expired link", async () => {
    h.result = { kind: "expired" };
    expect(await submit({ token: "tok", email: "pat@example.org" })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    h.result = { kind: "invalid" };
    expect(await submit({ token: "tok", email: "pat@example.org" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't valid/) });
  });

  it("throttles guesses per link, keyed by the token's hash, never the token", async () => {
    h.rlAllowed = false;
    expect(await submit({ token: "tok", email: "pat@example.org" })).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(h.confirmCalls).toHaveLength(0);
    expect(h.rlKeys[0]).toMatch(/^deletion-confirm:[0-9a-f]{64}$/);
  });

  it("refuses a submit without a token (it never takes a request id)", async () => {
    expect(await submit({ requestId: "req-1", email: "pat@example.org" })).toMatchObject({ ok: false });
    expect(h.confirmCalls).toHaveLength(0);
  });
});
