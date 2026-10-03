import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RESEARCH_TABS } from "@/components/public/ResearchTabs";
import { pageMetadata } from "@/lib/seo";
import sitemap from "@/app/sitemap";

// The public site after the 2026-10 restructure: Services and Research in the
// header, research pages under /research (the dataset keeps /snowpack_dataset),
// old URLs redirect permanently, and every page carries full search metadata.

const pub = (...p: string[]) => join(process.cwd(), "app", "(public)", ...p);
const pageExists = (route: string) => existsSync(pub(...route.split("/").filter(Boolean), "page.tsx"));
const read = (...p: string[]) => readFileSync(pub(...p), "utf8").replace(/\s+/g, " ").replace(/&apos;/g, "'");

describe("routes", () => {
  it("every Research tab points at a real page", () => {
    for (const t of RESEARCH_TABS) expect(pageExists(t.href), t.href).toBe(true);
  });

  it("moved pages redirect permanently, and the dataset keeps its URL", () => {
    const cfg = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(cfg).toContain('{ source: "/models", destination: "/research/models", permanent: true }');
    expect(cfg).toContain('{ source: "/methods", destination: "/research/methods", permanent: true }');
    expect(cfg).not.toMatch(/source: "\/snowpack_dataset"/);
    expect(pageExists("/snowpack_dataset")).toBe(true);
  });

  it("the sitemap lists only real pages, with the new URLs and none of the old", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    for (const u of urls) expect(pageExists(u === "/" ? "" : u), u).toBe(true);
    expect(urls).toEqual(expect.arrayContaining(["/services", "/research", "/research/models", "/research/methods", "/research/incident-detection"]));
    expect(urls).not.toContain("/models");
    expect(urls).not.toContain("/methods");
  });
});

describe("headers", () => {
  const publicLayout = read("layout.tsx");
  const portalLayout = readFileSync(join(process.cwd(), "app", "(portal)", "layout.tsx"), "utf8").replace(/\s+/g, " ");

  it("show Services and Research instead of Models, Data and Methods", () => {
    for (const src of [publicLayout, portalLayout]) {
      expect(src).toContain('href="/services"');
      expect(src).toContain('href="/research"');
      expect(src).not.toContain('href="/research/models"');
      expect(src).not.toMatch(/>\s*Methods\s*</);
    }
  });

  it("move GitHub and Hugging Face out of the header (Research tabs and the public footer keep them)", () => {
    expect(portalLayout).not.toContain("github.com/RMDig");
    expect(publicLayout).not.toContain('aria-label="RMDig on GitHub"');
    expect(publicLayout).toContain("{GITHUB_URL}");
  });

  it("show Settings as a labelled gear left of Sign out in the portal", () => {
    const gear = portalLayout.indexOf('aria-label="Settings"');
    expect(gear).toBeGreaterThan(-1);
    expect(gear).toBeLessThan(portalLayout.indexOf("<SignOutButton />"));
  });
});

describe("pageMetadata", () => {
  it("sets canonical, Open Graph and Twitter together", () => {
    const m = pageMetadata({ title: "T", description: "D", path: "/services" });
    expect(m.alternates?.canonical).toBe("/services");
    expect(m.openGraph).toMatchObject({ url: "/services", title: "T", description: "D", siteName: "RMDig · AvAI" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "T", images: ["/opengraph-image"] });
    expect(m.openGraph).toMatchObject({ images: [expect.objectContaining({ url: "/opengraph-image", width: 1200, height: 630 })] });
  });

  it("is used by every public page with metadata", () => {
    for (const page of ["page.tsx", "services/page.tsx", "research/page.tsx", "research/models/page.tsx", "snowpack_dataset/page.tsx", "avai/page.tsx", "privacy/page.tsx"]) {
      expect(read(...page.split("/")), page).toContain("pageMetadata({");
    }
  });
});

describe("new copy", () => {
  it("Services leads with check-out and claims nothing not yet live", () => {
    const src = read("services", "page.tsx");
    expect(src.indexOf("<h2>Check-out / check-in</h2>")).toBeLessThan(src.indexOf("<h2>Send Help</h2>"));
    expect(src).toContain("{BETA_DISCLOSURE}");
    expect(src).toContain("{OPERATOR_CONTINUITY_DISCLOSURE}");
    expect(src).not.toContain("/contribute");
    expect(src).not.toMatch(/Incident Detection/);
  });

  it("Incident Detection research states status, not capability", () => {
    const src = read("research", "incident-detection", "page.tsx");
    expect(src).toContain("There are no results yet.");
    expect(src).toContain("Incident Detection isn't available in AvAI.");
    expect(src).toContain("peer-reviewed by independent experts");
  });
});
