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
  const flat = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\s+/g, " ");
  const header = flat("components", "nav", "SiteHeader.tsx");
  const footer = flat("components", "nav", "SiteFooter.tsx");
  const publicLayout = read("layout.tsx");
  const portalLayout = flat("app", "(portal)", "layout.tsx");

  it("are one shared header and footer on public and portal pages, so the tabs don't change between them", () => {
    expect(publicLayout).toContain('<SiteHeader viewer="probe" />');
    expect(portalLayout).toContain("<SiteHeader viewer={viewer}");
    for (const src of [publicLayout, portalLayout]) expect(src).toContain("<SiteFooter />");
  });

  it("show Services and Research instead of Models, Data and Methods", () => {
    expect(header).toContain('href: "/services"');
    expect(header).toContain('href: "/research"');
    expect(header).not.toContain("/research/models");
    expect(header).not.toMatch(/>\s*Methods\s*</);
  });

  it("move GitHub and Hugging Face out of the header (Research tabs and the footer keep them)", () => {
    expect(header).not.toContain("github.com/RMDig");
    expect(header).not.toContain("GITHUB_URL");
    expect(footer).toContain("{GITHUB_URL}");
  });

  it("show Settings as a labelled gear left of Sign out", () => {
    const gear = header.indexOf('aria-label="Settings"');
    expect(gear).toBeGreaterThan(-1);
    expect(gear).toBeLessThan(header.indexOf("{signOut ??"));
    expect(portalLayout).toContain("signOut={<SignOutButton />}");
  });

  it("keep the public pages free of auth and the database (CLAUDE.md §3.7): the header asks /api/nav instead", () => {
    for (const f of [["components", "nav", "SiteHeader.tsx"], ["components", "nav", "SiteFooter.tsx"], ["lib", "nav", "types.ts"], ["app", "(public)", "layout.tsx"]]) {
      const src = flat(...f);
      expect(src, f.join("/")).not.toMatch(/from "@\/lib\/(auth|db)|from "@\/lib\/nav\/viewer"/);
    }
    expect(header).toContain('fetch("/api/nav")');
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
