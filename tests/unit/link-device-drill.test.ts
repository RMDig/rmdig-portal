import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Settings → Devices tells a drill user to link only the DRILL build from a
// fresh install (plan 37 §4.11, P7d). A real user's card is unchanged.

vi.mock("@/app/(portal)/settings/actions", () => ({ mintDeviceLinkCodeAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { DRILL_LINK_NOTE, LinkDeviceCard } from "@/app/(portal)/settings/LinkDeviceCard";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";

const html = (drill: boolean) => renderToStaticMarkup(React.createElement(LinkDeviceCard, { devices: [], drill })).replace(/&#x27;/g, "'");

describe("LinkDeviceCard for a drill user", () => {
  it("says to link only the DRILL build, from a fresh install", () => {
    expect(html(true)).toContain(DRILL_LINK_NOTE);
    expect(DRILL_LINK_NOTE).toContain("DRILL build");
    expect(DRILL_LINK_NOTE).toContain("fresh install");
  });

  it("says nothing of drills to a real user", () => {
    expect(html(false)).not.toContain(DRILL_LINK_NOTE);
    expect(html(false).toLowerCase()).not.toContain("drill");
  });

  it("uses none of the forbidden claim words", () => {
    for (const p of FORBIDDEN_PUBLIC_PHRASES) expect(DRILL_LINK_NOTE.toLowerCase()).not.toContain(p.toLowerCase());
  });
});
