import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /contribute is a public, no-auth, no-DB route (CLAUDE.md §3.7) whose only
// runtime input is the Stripe Payment Link env var. Render it both ways and
// scan the RENDERED html (not just the source) against both ban lists — the
// body copy is imported from a constant, so a source-only scan would miss it.

const h = vi.hoisted(() => ({
  env: {} as { CONTRIBUTE_PAYMENT_LINK_URL?: string },
}));

vi.mock("@/lib/env", () => ({ env: h.env }));

import ContributePage from "@/app/(public)/contribute/page";
import {
  CONTRIBUTE_BODY,
  CONTRIBUTE_FORBIDDEN_PHRASES,
  FORBIDDEN_PUBLIC_PHRASES,
} from "@/lib/legal/compliance-copy";

const PAYMENT_LINK = "https://buy.stripe.com/test_00000000";

function render(): string {
  return renderToStaticMarkup(React.createElement(ContributePage));
}

function forbiddenPattern(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i");
}

function expectCleanCopy(html: string) {
  // The verbatim body is exempted (it carries the required "not
  // tax-deductible"); everything else on the page must pass both lists.
  expect(html).toContain(CONTRIBUTE_BODY);
  const rest = html.replace(CONTRIBUTE_BODY, "");
  for (const phrase of [...FORBIDDEN_PUBLIC_PHRASES, ...CONTRIBUTE_FORBIDDEN_PHRASES]) {
    expect(forbiddenPattern(phrase).test(rest), `"${phrase}" rendered on /contribute`).toBe(false);
  }
}

describe("/contribute page", () => {
  beforeEach(() => {
    delete h.env.CONTRIBUTE_PAYMENT_LINK_URL;
  });

  it("renders the Stripe Payment Link button when configured", () => {
    h.env.CONTRIBUTE_PAYMENT_LINK_URL = PAYMENT_LINK;
    const html = render();

    expect(html).toContain(`href="${PAYMENT_LINK}"`);
    expect(html).toMatch(/One-time contribution/);
    expect(html).not.toMatch(/open yet/);
    expect(html).toContain('href="/terms"');
    expectCleanCopy(html);
  });

  it("renders a visible not-open state, and no external link, when unconfigured", () => {
    const html = render();

    expect(html).toMatch(/Contributions aren(&#x27;|')t open yet/);
    expect(html).not.toMatch(/href="https?:\/\//);
    expect(html).not.toMatch(/stripe/i);
    expect(html).toContain('href="/terms"');
    expectCleanCopy(html);
  });

  it("never links /support into the money ask", () => {
    // Doc 35 §4.3: /support is the store-mandated customer-support page; the
    // contribution page points at /terms and the support mailbox, not /support.
    h.env.CONTRIBUTE_PAYMENT_LINK_URL = PAYMENT_LINK;
    expect(render()).not.toContain('href="/support"');
  });
});

describe("/contribute dataset guidance", () => {
  beforeEach(() => {
    delete h.env.CONTRIBUTE_PAYMENT_LINK_URL;
  });

  it("says submitting needs a coring kit and isn't available yet", () => {
    const html = render();
    expect(html).toMatch(/Anyone will be able to submit snowpack samples/);
    expect(html).toMatch(/AvAI coring kit/);
    expect(html).toMatch(/Submitting isn(&#x27;|')t available yet/);
  });

  it("states the planned payment and the right to reject low-quality samples, pending counsel", () => {
    const html = render();
    expect(html).toMatch(/about \$0\.01 per photo/);
    expect(html).toMatch(/we may reject samples that are low quality/);
    expect(html).toMatch(/Rejected samples aren(&#x27;|')t paid for or published/);
    expect(html).toMatch(/\[COUNSEL\] Submission and payment terms/);
  });

  it("encourages open-source release for non-safety models and for validated pre-training advantage, separately", () => {
    const html = render();
    expect(html).toMatch(/Building AI models with the snowpack dataset is more than welcome/);
    expect(html).toMatch(/Models not meant for safety decisions/);
    expect(html).toMatch(/Models that show a validated advantage from pre-training/);
    expect(html).toMatch(/peer-reviewed by independent experts before\s+you release/);
  });

  it("states rmdig's own model policy", () => {
    const html = render();
    expect(html).toMatch(/We release our models that aren(&#x27;|')t\s+meant for safety decisions as open source/);
    expect(html).toMatch(/only after independent experts have peer-reviewed them/);
  });

  it("keeps 'contribution' for money: the footer covers payments, not samples", () => {
    const html = render();
    expect(html).toMatch(/Payments to rmdig are covered by our/);
    expect(html).not.toMatch(/Contributions are covered by/);
  });

  it("frames the guidance as requests, deferring to the dataset license", () => {
    expect(render()).toMatch(/not license terms/);
  });
});
