import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributePage from "@/app/(public)/contribute/page";
import {
  CONTRIBUTE_BODY,
  CONTRIBUTE_FORBIDDEN_PHRASES,
  FORBIDDEN_PUBLIC_PHRASES,
} from "@/lib/legal/compliance-copy";

// /contribute is a public, no-auth, no-DB route (CLAUDE.md §3.7) and the
// target of AvApp's kContributeUrl. It renders here with no session, DB or env
// mocked — nothing is mocked because the page must need none of them. The
// RENDERED html is scanned (not just the source): the body is imported from a
// constant, so a source-only scan would miss it.

const SOURCE = readFileSync(join(process.cwd(), "app", "(public)", "contribute", "page.tsx"), "utf8");

function render(): string {
  return renderToStaticMarkup(React.createElement(ContributePage));
}

function forbiddenPattern(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i");
}

describe("/contribute page", () => {
  it("imports nothing that needs a session, the DB, or env", () => {
    expect(SOURCE).not.toMatch(/from "@\/lib\/(auth|db|env)/);
    expect(SOURCE).not.toMatch(/process\.env/);
  });

  it("renders the verbatim body and carries no forbidden claim", () => {
    const html = render();
    // The verbatim body is exempted (it carries the required "not
    // tax-deductible"); everything else must pass both lists.
    expect(html).toContain(CONTRIBUTE_BODY);
    const rest = html.replace(CONTRIBUTE_BODY, "");
    for (const phrase of [...FORBIDDEN_PUBLIC_PHRASES, ...CONTRIBUTE_FORBIDDEN_PHRASES]) {
      expect(forbiddenPattern(phrase).test(rest), `"${phrase}" rendered on /contribute`).toBe(false);
    }
  });

  it("states contributions aren't open, with no payment link", () => {
    const html = render();
    expect(html).toMatch(/Contributions aren(&#x27;|')t open yet/);
    expect(html).not.toMatch(/href="https?:\/\//);
    expect(html).not.toMatch(/stripe/i);
  });

  it("never links /support into the money ask", () => {
    // Doc 35 §4.3: /support is the store-mandated customer-support page.
    expect(render()).not.toContain('href="/support"');
  });

  it("makes no claim about sample payment or kit sales", () => {
    const html = render();
    expect(html).toMatch(/Submitting snowpack samples to the dataset isn(&#x27;|')t available yet/);
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/coring kit/i);
  });
});

describe("/contribute dataset guidance", () => {
  it("encourages open-source release for non-safety models and for validated pre-training advantage, separately", () => {
    const html = render();
    expect(html).toContain('href="/snowpack_dataset"');
    expect(html).toMatch(/Models not meant for safety decisions/);
    expect(html).toMatch(/Models that show a validated advantage from pre-training/);
    expect(html).toMatch(/peer-reviewed by independent experts before\s+you release/);
  });

  it("states rmdig's own model policy", () => {
    const html = render();
    expect(html).toMatch(/We release our models that aren(&#x27;|')t\s+meant for safety decisions as open source/);
    expect(html).toMatch(/only after independent experts have peer-reviewed them/);
  });

  it("frames the guidance as requests, deferring to the dataset license", () => {
    expect(render()).toMatch(/not license terms/);
  });
});
