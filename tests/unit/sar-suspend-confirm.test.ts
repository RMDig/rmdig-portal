import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(portal)/admin/sar-approvals/actions", () => ({ reviewSarOrgAction: vi.fn(), resyncSarOrgAction: vi.fn() }));
vi.mock("@/app/(portal)/admin/sar-drill/actions", () => ({ activateDrillOrgAction: vi.fn() }));

import { DrillDecisions } from "@/app/(portal)/admin/sar-drill/DrillDecisions";
import { SuspendConfirm } from "@/components/sar/SuspendConfirm";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";
import { SUSPEND_COPY } from "@/lib/sar/suspend-copy";

// Suspend stops a team's alerts at once, so one click must never do it. On
// 2026-11-11 a drill team was suspended by a stray click on the Suspend button
// that took Activate's place when the page reloaded.

const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'");
const confirm = (over: Partial<React.ComponentProps<typeof SuspendConfirm>> = {}) =>
  html(
    React.createElement(SuspendConfirm, {
      formAction: vi.fn(),
      orgId: "70db93ac-a020-411a-a1bc-472d13a09cb9",
      orgName: "AvAI Drill Team",
      revision: 7,
      pending: false,
      isDrill: true,
      ...over,
    }),
  );

describe("SuspendConfirm", () => {
  it("starts as a button that opens the confirm, with no form to submit", () => {
    const out = confirm();
    expect(out).toContain(SUSPEND_COPY.trigger);
    expect(out).not.toContain("<form");
    expect(out).not.toContain('type="submit"');
    expect(out).not.toContain('value="suspend"');
  });

  it("opens to the warning, then Cancel before the suspend button", () => {
    const out = confirm({ initiallyOpen: true });
    expect(out).toContain(SUSPEND_COPY.heading("AvAI Drill Team"));
    expect(out).toContain(SUSPEND_COPY.effect);
    expect(out).toContain('name="decision" value="suspend"');
    expect(out).toContain('name="revision" value="7"');
    const cancel = out.indexOf(SUSPEND_COPY.cancel);
    const submit = out.indexOf(SUSPEND_COPY.confirm);
    expect(out.indexOf(SUSPEND_COPY.effect)).toBeLessThan(cancel);
    expect(cancel).toBeLessThan(submit);
  });

  it("says how each kind of team comes back", () => {
    expect(confirm({ initiallyOpen: true })).toContain(SUSPEND_COPY.undo.drill);
    const real = confirm({ initiallyOpen: true, isDrill: false });
    expect(real).toContain(SUSPEND_COPY.undo.real);
    expect(real).not.toContain(SUSPEND_COPY.undo.drill);
  });

  it("offers the note only where it's recorded", () => {
    expect(confirm({ initiallyOpen: true })).not.toContain('name="note"');
    expect(confirm({ initiallyOpen: true, withNote: true })).toContain('name="note"');
  });

  it("uses none of the forbidden claim words", () => {
    const text = [SUSPEND_COPY.effect, SUSPEND_COPY.undo.real, SUSPEND_COPY.undo.drill].join(" ").toLowerCase();
    for (const p of FORBIDDEN_PUBLIC_PHRASES) expect(text).not.toContain(p.toLowerCase());
  });
});

describe("DrillDecisions on an approved drill team", () => {
  const drill = (status: string) =>
    html(React.createElement(DrillDecisions, { orgId: "o", orgName: "AvAI Drill Team", revision: 3, status, canActivate: true, canSuspend: true }));

  it("puts Suspend behind the confirm, never a one-click submit", () => {
    const out = drill("approved");
    expect(out).toContain(SUSPEND_COPY.trigger);
    expect(out).not.toContain('value="suspend"');
    expect(out).not.toContain('type="submit"');
  });

  it("still activates a pending one in one click, its own logged decision", () => {
    const out = drill("pending");
    expect(out).toContain("Activate drill team");
    expect(out).not.toContain(SUSPEND_COPY.trigger);
  });
});
