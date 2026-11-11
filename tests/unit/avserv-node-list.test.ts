import { describe, expect, it } from "vitest";

import { checkNodeListConfig, parseNodeUrls } from "@/lib/avserv/node-list";

// AVSERV_NODE_URLS (AvServ, 2026-11-11): every node a SAR team goes to, so
// avserv-1 joins by a config change on the day.

describe("parseNodeUrls", () => {
  it("parses https and mock nodes in order, trimmed", () => {
    expect(parseNodeUrls(" https://avserv-2.rmdig.ai , https://avserv-3.rmdig.ai/ ")).toEqual([
      { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" },
      { name: "avserv-3.rmdig.ai", baseUrl: "https://avserv-3.rmdig.ai" },
    ]);
    expect(parseNodeUrls("mock://localhost")).toEqual([{ name: "mock", baseUrl: "mock://localhost" }]);
    expect(parseNodeUrls(undefined)).toEqual([]);
    expect(parseNodeUrls(" ")).toEqual([]);
  });

  it("throws on a URL that isn't https, isn't a URL, or is listed twice", () => {
    expect(() => parseNodeUrls("http://avserv-2.rmdig.ai")).toThrow(/https/);
    expect(() => parseNodeUrls("avserv-2.rmdig.ai")).toThrow(/not a URL/);
    expect(() => parseNodeUrls("https://avserv-2.rmdig.ai,https://avserv-2.rmdig.ai/")).toThrow(/twice/);
  });
});

describe("checkNodeListConfig (production build)", () => {
  const base = { AVSERV_BASE_URL: "https://avserv-2.rmdig.ai", AVSERV_FAILOVER_BASE_URL: "https://avserv-3.rmdig.ai" };

  it("skips a mock or absent AvServ", () => {
    expect(checkNodeListConfig({})).toEqual({ status: "skipped" });
    expect(checkNodeListConfig({ AVSERV_BASE_URL: "mock://localhost" })).toEqual({ status: "skipped" });
  });

  it("passes a list with the primary and failover, and with avserv-1 added", () => {
    expect(checkNodeListConfig({ ...base, AVSERV_NODE_URLS: "https://avserv-2.rmdig.ai,https://avserv-3.rmdig.ai" })).toEqual({
      status: "ok",
      nodes: ["avserv-2.rmdig.ai", "avserv-3.rmdig.ai"],
    });
    expect(checkNodeListConfig({ ...base, AVSERV_NODE_URLS: "https://avserv-2.rmdig.ai,https://avserv-3.rmdig.ai,https://avserv-1.rmdig.ai" })).toMatchObject({ status: "ok" });
  });

  it("fails an unset list, a malformed one, or one missing the primary or failover", () => {
    expect(checkNodeListConfig(base)).toMatchObject({ status: "error", error: expect.stringContaining("not set") });
    expect(checkNodeListConfig({ ...base, AVSERV_NODE_URLS: "http://avserv-2.rmdig.ai" })).toMatchObject({ status: "error" });
    expect(checkNodeListConfig({ ...base, AVSERV_NODE_URLS: "https://avserv-2.rmdig.ai" })).toMatchObject({
      status: "error",
      error: expect.stringContaining("AVSERV_FAILOVER_BASE_URL"),
    });
    expect(checkNodeListConfig({ ...base, AVSERV_NODE_URLS: "https://avserv-3.rmdig.ai,https://avserv-2.rmdig.ai" })).toMatchObject({
      status: "error",
      error: expect.stringContaining("must start with AVSERV_BASE_URL"),
    });
  });
});
