import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// avservFetch and callWithFailover tell an AvServ outage apart from a fault of
// ours: no answer is "unreachable" (retried on the other node, logged), while
// a signing-key problem propagates as itself (never retried, goes to Sentry).

const h = vi.hoisted(() => ({ sign: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: h.sign }));
vi.mock("@/lib/env", () => ({ env: { AVSERV_FAILOVER_BASE_URL: "https://avserv-3.example" } }));
const s = vi.hoisted(() => ({ capture: vi.fn(), error: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: s.capture }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: s.error } }));

import { AvServContractError, AvServError, avservFetch, callWithFailover, failureCode, isAvServOutage } from "@/lib/avserv/request";

beforeEach(() => {
  h.sign.mockReset().mockResolvedValue("jwt");
  h.fetch.mockReset();
  vi.stubGlobal("fetch", h.fetch);
});

describe("avservFetch", () => {
  it("tags a node that doesn't answer as unreachable", async () => {
    h.fetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(avservFetch("https://avserv-2.example", "/x", { method: "GET" })).rejects.toMatchObject({
      name: "AvServError",
      code: "unreachable",
      status: undefined,
    });
  });

  it("lets a signing failure through as itself, without calling out", async () => {
    h.sign.mockRejectedValue(new Error("AVSERV_SERVICE_JWT_SIGNING_KEY is not set"));
    const err = await avservFetch("https://avserv-2.example", "/x", { method: "GET" }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AvServError);
    expect((err as Error).message).toMatch(/SIGNING_KEY/);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("callWithFailover", () => {
  const schema = z.object({ ok: z.literal(true) });

  it("tries the other node when the first is unreachable, keeping the code if both are", async () => {
    h.fetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(callWithFailover("https://avserv-2.example", "/x", { method: "GET" }, schema, "test")).rejects.toMatchObject({
      name: "AvServContractError",
      code: "unreachable",
      viaFailover: true,
    });
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry or wrap a signing failure", async () => {
    h.sign.mockRejectedValue(new Error("bad key"));
    const err = await callWithFailover("https://avserv-2.example", "/x", { method: "GET" }, schema, "test").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AvServContractError);
    expect(h.sign).toHaveBeenCalledTimes(1);
  });
});

describe("isAvServOutage", () => {
  it("is an outage for no answer, a 5xx, or the failover node lagging", () => {
    expect(isAvServOutage(new AvServError("x", undefined, "unreachable"))).toBe(true);
    expect(isAvServOutage(new AvServError("x", 503))).toBe(true);
    expect(isAvServOutage(new AvServError("x", 404, "failover_lag"))).toBe(true);
  });
  it("is a fault for a 4xx, a bad response, or anything that isn't an AvServ error", () => {
    expect(isAvServOutage(new AvServError("unknown account", 404))).toBe(false);
    expect(isAvServOutage(new AvServError("schema validation failed"))).toBe(false);
    expect(isAvServOutage(new Error("bad key"))).toBe(false);
  });
});

describe("failureCode", () => {
  it("keeps a network failure as unreachable, without alarming anyone", () => {
    expect(failureCode(new AvServError("x", undefined, "unreachable"), { call: "t" })).toBe("unreachable");
    expect(s.capture).not.toHaveBeenCalled();
  });
  it("reports anything else as a portal fault: logged, sent to Sentry, labelled with its message", () => {
    const err = new TypeError('"pkcs8" must be PKCS#8 formatted string');
    expect(failureCode(err, { call: "red_feed", node: "a2" })).toBe('portal_fault: "pkcs8" must be PKCS#8 formatted string');
    expect(s.error).toHaveBeenCalledWith(expect.objectContaining({ event: "avserv.request.portal_fault", call: "red_feed", node: "a2" }));
    expect(s.capture).toHaveBeenCalledWith(err, expect.anything());
  });
});
