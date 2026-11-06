import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(portal)/settings/devices/actions", () => ({
  previewRevokeAction: vi.fn(),
  revokeDeviceAction: vi.fn(),
  strengthenRevokeAction: vi.fn(),
  revokeOtherDevicesAction: vi.fn(),
  mintResetCodeAction: vi.fn(),
}));

import { DevicesList } from "@/app/(portal)/settings/devices/DevicesList";
import { StrengthenRevoke } from "@/app/(portal)/settings/devices/DeviceRevoke";
import { REVOKE_COPY } from "@/app/(portal)/settings/devices/revoke-copy";
import type { LinkedDevice } from "@/lib/avserv/client";

// "Make this stronger" (plan 36 §5.1): offered only on a phone signed out in
// limited mode, and only when the user has a passkey old enough to make it full.

const phone = (over: Partial<LinkedDevice>): LinkedDevice => ({
  deviceId: "22222222-2222-4222-8222-222222222222",
  platform: "iOS",
  appVersion: "1.0.0",
  createdAt: "2026-10-01T12:00:00Z",
  lastSeenAt: "2026-11-01T12:00:00Z",
  userRevokedAt: null,
  revokeReason: null,
  revokeMode: null,
  ...over,
});
const signedOut = (mode: "limited" | "full" | null) =>
  phone({ userRevokedAt: "2026-11-05T18:00:00Z", revokeReason: "user", revokeMode: mode });

const html = (devices: LinkedDevice[], canStrengthen: boolean, revokeAvailable = true) =>
  renderToStaticMarkup(React.createElement(DevicesList, { devices, incomplete: false, revokeAvailable, canStrengthen })).replace(
    /&#x27;/g,
    "'",
  );

describe("Make this stronger on Settings → Devices", () => {
  it("is offered on a limited sign-out when the user has an old enough passkey", () => {
    const out = html([signedOut("limited")], true);
    expect(out).toContain(REVOKE_COPY.strengthenButton);
    expect(out).toContain(REVOKE_COPY.strengthenOffer);
  });

  it("isn't offered without such a passkey, on a full or unknown mode, a live phone, or with revoke unavailable", () => {
    expect(html([signedOut("limited")], false)).not.toContain(REVOKE_COPY.strengthenButton);
    expect(html([signedOut("full")], true)).not.toContain(REVOKE_COPY.strengthenButton);
    expect(html([signedOut(null)], true)).not.toContain(REVOKE_COPY.strengthenButton);
    expect(html([phone({})], true)).not.toContain(REVOKE_COPY.strengthenButton);
    expect(html([signedOut("limited")], true, false)).not.toContain(REVOKE_COPY.strengthenButton);
  });

  it("doesn't warn about erasing until the user opens the confirm", () => {
    const out = renderToStaticMarkup(React.createElement(StrengthenRevoke, { deviceId: "d", offer: true }));
    expect(out).toContain(REVOKE_COPY.strengthenButton);
    expect(out).not.toContain(REVOKE_COPY.fieldData.full);
    expect(out).not.toContain(REVOKE_COPY.strengthenConfirm);
  });

  it("renders nothing once there's no offer and no result to show", () => {
    expect(renderToStaticMarkup(React.createElement(StrengthenRevoke, { deviceId: "d", offer: false }))).toBe("");
  });
});
