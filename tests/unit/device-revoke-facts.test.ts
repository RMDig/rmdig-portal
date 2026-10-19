import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(portal)/settings/devices/actions", () => ({
  previewRevokeAction: vi.fn(),
  revokeDeviceAction: vi.fn(),
}));

import { RevokeFacts } from "@/app/(portal)/settings/devices/DeviceRevoke";
import { REVOKE_COPY } from "@/app/(portal)/settings/devices/revoke-copy";

// Owner, 2026-10-18 (AvApp plan 54 §7.1a item 5): only a full revoke erases
// the phone's unsynced field data, so only a full revoke warns about it.
const html = (mode: "limited" | "full") =>
  renderToStaticMarkup(React.createElement(RevokeFacts, { mode })).replace(/&#x27;/g, "'");

describe("RevokeFacts", () => {
  it("warns that unsynced observations and photos will be erased on a full revoke", () => {
    expect(html("full")).toContain(REVOKE_COPY.fieldData.full);
    expect(html("full")).not.toContain(REVOKE_COPY.fieldData.limited);
  });

  it("says field data stays, locked, on a limited revoke, and never mentions erasing", () => {
    expect(html("limited")).toContain(REVOKE_COPY.fieldData.limited);
    expect(html("limited")).not.toMatch(/eras/i);
  });

  it("says Send Help still works in both modes", () => {
    for (const mode of ["limited", "full"] as const) expect(html(mode)).toContain(REVOKE_COPY.sendHelpStays);
  });
});
