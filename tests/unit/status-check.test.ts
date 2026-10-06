import { describe, expect, it, vi } from "vitest";

import { checkNodes, nodeBases, overall } from "@/lib/status/check";

describe("public status checks", () => {
  it("checks only real https/http nodes (mock and unset are skipped)", () => {
    expect(nodeBases("https://avserv-2.rmdig.ai", "https://avserv-3.rmdig.ai")).toHaveLength(2);
    expect(nodeBases("mock://localhost", undefined)).toEqual([]);
  });

  it("calls each node's public readiness check and treats an error or timeout as not answering", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockRejectedValueOnce(new Error("timeout"));
    const nodes = await checkNodes(["https://a2.example/", "https://a3.example"], fetcher as unknown as typeof fetch);
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(["https://a2.example/readyz", "https://a3.example/readyz"]);
    expect(nodes).toEqual([
      { name: "Alert server 1", up: true },
      { name: "Alert server 2", up: false },
    ]);
  });

  it("summarizes as up, partial, down or unchecked", () => {
    expect(overall([{ name: "a", up: true }, { name: "b", up: true }])).toBe("up");
    expect(overall([{ name: "a", up: true }, { name: "b", up: false }])).toBe("partial");
    expect(overall([{ name: "a", up: false }, { name: "b", up: false }])).toBe("down");
    expect(overall([])).toBe("unchecked");
  });
});
