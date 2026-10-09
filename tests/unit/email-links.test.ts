import { beforeEach, describe, expect, it, vi } from "vitest";

// The base of every emailed link: production's NEXTAUTH_URL, a preview's own
// deployment host, or localhost for local development.

const h = vi.hoisted(() => ({
  env: {} as { NEXTAUTH_URL?: string; VERCEL_ENV?: string; VERCEL_URL?: string },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("../../lib/env", () => ({ env: h.env }));

import { portalUrl } from "@/lib/email/links";

beforeEach(() => {
  delete h.env.NEXTAUTH_URL;
  delete h.env.VERCEL_ENV;
  delete h.env.VERCEL_URL;
});

describe("portalUrl", () => {
  it("uses NEXTAUTH_URL when set (production)", () => {
    h.env.NEXTAUTH_URL = "https://rmdig.ai";
    h.env.VERCEL_ENV = "production";
    h.env.VERCEL_URL = "rmdig-portal-abc.vercel.app";
    expect(portalUrl("/api/verify?token=t")).toBe("https://rmdig.ai/api/verify?token=t");
  });

  it("points a preview's links at the preview itself, not localhost", () => {
    h.env.VERCEL_ENV = "preview";
    h.env.VERCEL_URL = "rmdig-portal-abc-team.vercel.app";
    expect(portalUrl("/invite/xyz")).toBe("https://rmdig-portal-abc-team.vercel.app/invite/xyz");
  });

  it("falls back to localhost for local development", () => {
    expect(portalUrl("/invite/xyz")).toBe("http://localhost:3000/invite/xyz");
    h.env.VERCEL_URL = "ignored-without-preview.vercel.app";
    expect(portalUrl("/invite/xyz")).toBe("http://localhost:3000/invite/xyz");
  });
});
