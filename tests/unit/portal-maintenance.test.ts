import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  maintenancePage,
  parseSwitch,
  readSwitch,
  resetSwitchCache,
  retryAfterSeconds,
  staysUp,
  STAYS_UP,
} from "@/lib/maintenance/portal-switch";
import { STATUS_PAGE_URL } from "@/lib/status-page";

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/global-config", () => ({ createClient: () => ({ get: h.get }) }));

// The planned-maintenance switch: portal routes get a static 503 while it's on;
// the public gates and probes never do; a broken or unreachable config store
// never takes anything down.

describe("staysUp", () => {
  it("keeps the public gates and probes up, including sub-paths", () => {
    for (const p of ["/", "/privacy", "/terms", "/sms", "/alerts", "/support", "/account/delete", "/account/delete/confirm", "/healthz", "/readyz"]) {
      expect(staysUp(p), p).toBe(true);
    }
  });

  it("takes portal routes down", () => {
    for (const p of ["/settings", "/settings/devices", "/admin", "/sar/new", "/sign-in", "/account/review", "/account", "/api/geo/search", "/privacy-old"]) {
      expect(staysUp(p), p).toBe(false);
    }
  });

  it("lists every route under app/(public), so a new public page can't be swallowed", () => {
    const pub = join(process.cwd(), "app", "(public)");
    const routes = readdirSync(pub).filter((e) => statSync(join(pub, e)).isDirectory());
    for (const r of routes) {
      const path = r === "account" ? "/account/delete" : `/${r}`;
      expect(STAYS_UP as readonly string[], path).toContain(path);
    }
  });
});

describe("parseSwitch", () => {
  it("accepts the documented shape", () => {
    expect(parseSwitch({ enabled: true, message: "DB upgrade", endsAt: "2026-10-04T08:30:00Z" })).toEqual({
      enabled: true,
      message: "DB upgrade",
      endsAt: "2026-10-04T08:30:00Z",
    });
  });

  it("rejects anything else rather than treating it as on", () => {
    for (const bad of [true, "on", { enabled: "yes" }, { enabled: true, endsAt: "Saturday" }, { enabled: true, message: "x".repeat(301) }]) {
      expect(parseSwitch(bad)).toBeNull();
    }
  });
});

describe("retryAfterSeconds", () => {
  const now = new Date("2026-10-04T08:00:00Z");
  it("counts down to endsAt, clamped to 60–3600 s", () => {
    expect(retryAfterSeconds({ enabled: true, endsAt: "2026-10-04T08:10:00Z" }, now)).toBe(600);
    expect(retryAfterSeconds({ enabled: true, endsAt: "2026-10-04T07:00:00Z" }, now)).toBe(60);
    expect(retryAfterSeconds({ enabled: true, endsAt: "2026-10-05T08:00:00Z" }, now)).toBe(3600);
  });
  it("defaults to 5 minutes with no end time", () => {
    expect(retryAfterSeconds({ enabled: true }, now)).toBe(300);
  });
});

describe("maintenancePage", () => {
  it("shows the message and the end time in Mountain time", () => {
    const html = maintenancePage({ enabled: true, message: "Upgrading the database.", endsAt: "2026-10-04T08:30:00Z" });
    expect(html).toContain("The portal is down for maintenance");
    expect(html).toContain("Upgrading the database.");
    expect(html).toMatch(/Expected back by Sun, Oct 4, 2:30\s?AM MDT/);
    expect(html).toContain('href="/support"');
  });

  it("escapes the operator's message", () => {
    expect(maintenancePage({ enabled: true, message: '<script>alert("x")</script>' })).not.toContain("<script>");
  });

  it("has a default message and no end time when none is given", () => {
    const html = maintenancePage({ enabled: true });
    expect(html).toContain("We're updating the portal");
    expect(html).not.toContain("Expected back");
  });

  it("links the public status page", () => {
    expect(maintenancePage({ enabled: true })).toContain(`<a href="${STATUS_PAGE_URL}">Service status</a>`);
  });
});

describe("readSwitch", () => {
  beforeEach(() => resetSwitchCache());

  it("caches the value for 30 s", async () => {
    const read = vi.fn().mockResolvedValue({ enabled: true });
    await readSwitch(read, 0);
    await readSwitch(read, 29_000);
    expect(read).toHaveBeenCalledTimes(1);
    await readSwitch(read, 31_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("fails open, loudly, when the store can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readSwitch(vi.fn().mockRejectedValue(new Error("network")), 0)).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("maintenance.switch_unreadable"));
    log.mockRestore();
  });

  it("ignores, loudly, a value that doesn't parse", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readSwitch(vi.fn().mockResolvedValue("on"), 0)).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("maintenance.switch_invalid"));
    log.mockRestore();
  });

  it("treats a missing key as off, silently", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readSwitch(vi.fn().mockResolvedValue(undefined), 0)).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("middleware with the switch", () => {
  const req = (url: string) => new NextRequest(new URL(url), { headers: { host: new URL(url).host } });

  beforeEach(() => {
    vi.resetModules();
    process.env.GLOBAL_CONFIG = "https://global-config.example/ecfg_test?token=t";
    h.get.mockReset();
  });
  afterEach(() => {
    delete process.env.GLOBAL_CONFIG;
  });

  it("serves the 503 page on a portal route while enabled", async () => {
    h.get.mockResolvedValue({ enabled: true, message: "Back soon.", endsAt: new Date(Date.now() + 600_000).toISOString() });
    const { middleware } = await import("@/middleware");
    const res = await middleware(req("https://rmdig.ai/settings"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(590);
    expect(await res.text()).toContain("Back soon.");
  });

  it("never reads the switch for public pages", async () => {
    h.get.mockResolvedValue({ enabled: true });
    const { middleware } = await import("@/middleware");
    const res = await middleware(req("https://rmdig.ai/privacy"));
    expect(res.status).toBe(200);
    expect(h.get).not.toHaveBeenCalled();
  });

  it("passes through when disabled or unreachable", async () => {
    h.get.mockResolvedValue({ enabled: false });
    let { middleware } = await import("@/middleware");
    expect((await middleware(req("https://rmdig.ai/settings"))).status).toBe(200);

    vi.resetModules();
    h.get.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    ({ middleware } = await import("@/middleware"));
    expect((await middleware(req("https://rmdig.ai/settings"))).status).toBe(200);
  });

  it("still redirects legacy hosts first", async () => {
    h.get.mockResolvedValue({ enabled: true });
    const { middleware } = await import("@/middleware");
    expect((await middleware(req("https://app.rmdig.ai/settings"))).status).toBe(308);
  });
});
