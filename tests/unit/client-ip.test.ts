import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requestHeaders: {} as Record<string, string> }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers(h.requestHeaders)),
}));

import { clientIp } from "@/lib/client-ip";

beforeEach(() => {
  h.requestHeaders = {};
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", async () => {
    h.requestHeaders = { "x-forwarded-for": "203.0.113.9, 10.0.0.1, 172.16.0.1" };
    expect(await clientIp()).toBe("203.0.113.9");
  });

  it("trims whitespace around the first hop", async () => {
    h.requestHeaders = { "x-forwarded-for": "  203.0.113.9 , 10.0.0.1" };
    expect(await clientIp()).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    h.requestHeaders = { "x-real-ip": "198.51.100.4" };
    expect(await clientIp()).toBe("198.51.100.4");
  });

  // Fail closed: headerless requests share one bucket instead of each getting
  // a fresh rate-limit window.
  it("returns the shared 'unknown' bucket with no headers", async () => {
    expect(await clientIp()).toBe("unknown");
  });

  it("does not let an empty x-forwarded-for bypass the x-real-ip fallback", async () => {
    h.requestHeaders = { "x-forwarded-for": "", "x-real-ip": "198.51.100.4" };
    expect(await clientIp()).toBe("198.51.100.4");
  });
});
