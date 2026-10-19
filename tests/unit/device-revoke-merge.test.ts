import { describe, expect, it } from "vitest";

import type { LinkedDevice } from "@/lib/avserv/client";
import { mergeDeviceLists, mergePreviews, summarizeRevoke, summarizeRevokeOthers } from "@/lib/avserv/device-revoke-merge";
import type { NodeAnswer, Preview, RevokeAnswer, RevokeOthersAnswer } from "@/lib/avserv/device-revoke-types";

const preview = (node: string, live: Preview["live"], revoked = false): NodeAnswer<Preview> => ({
  node,
  ok: true,
  value: { accountId: "a", deviceId: "d", node, revoked, live },
});
const down = (node: string, code = "unreachable") => ({ node, ok: false as const, code });

describe("mergePreviews", () => {
  it("counts a trip seen on both nodes once, and never names an unknown kind", () => {
    const m = mergePreviews([
      preview("n2", [{ kind: "checkout", id: "c1" }, { kind: "held", id: null }]),
      preview("n3", [{ kind: "checkout", id: "c1" }, { kind: "help_request", id: "h1" }, { kind: "something_new", id: "x" }]),
    ]);
    expect(m.live).toEqual({ checkouts: 1, helpRequests: 1, other: 1, nextDueAt: null });
    expect(m).toMatchObject({ incomplete: false, failed: false, revoked: false });
  });

  it("takes the soonest due-back time across nodes and trips, ignoring a missing or bad one (rev 2.1)", () => {
    const m = mergePreviews([
      preview("n2", [{ kind: "checkout", id: "c1", dueAt: "2026-10-19T22:30:00Z" }, { kind: "checkout", id: "c2" }]),
      preview("n3", [{ kind: "checkout", id: "c3", dueAt: "2026-10-19T21:00:00Z" }, { kind: "checkout", id: "c4", dueAt: "garbage" }]),
    ]);
    expect(m.live).toMatchObject({ checkouts: 4, nextDueAt: "2026-10-19T21:00:00Z" });
  });

  it("is incomplete with one node down, failed with none, revoked if any node says so", () => {
    expect(mergePreviews([preview("n2", [], true), down("n3")])).toMatchObject({ incomplete: true, failed: false, revoked: true });
    expect(mergePreviews([down("n2"), down("n3")])).toMatchObject({ failed: true });
  });
});

const revoke = (node: string, mode: "limited" | "full", upgraded = false): NodeAnswer<RevokeAnswer> => ({
  node,
  ok: true,
  value: { accountId: "a", deviceId: "d", node, revokedAt: "t", reason: "lost", mode, alreadyRevoked: false, upgraded },
});

describe("summarizeRevoke", () => {
  it("is done when every node answered, with the strongest mode", () => {
    expect(summarizeRevoke([revoke("n2", "limited"), revoke("n3", "full", true)])).toEqual({
      status: "done",
      mode: "full",
      upgraded: true,
      missingNodes: [],
    });
  });

  it("is partial with one node missing, failed with none", () => {
    expect(summarizeRevoke([revoke("n2", "limited"), down("n3")])).toMatchObject({ status: "partial", missingNodes: ["n3"] });
    expect(summarizeRevoke([down("n2"), down("n3")])).toMatchObject({ status: "failed", mode: null });
  });
});

describe("summarizeRevokeOthers", () => {
  const others = (node: string, ids: string[]): NodeAnswer<RevokeOthersAnswer> => ({
    node,
    ok: true,
    value: {
      accountId: "a",
      node,
      keptDeviceId: "k",
      revoked: ids.map((deviceId) => ({ deviceId, revokedAt: "t", mode: "limited" as const, alreadyRevoked: false, upgraded: false })),
    },
  });

  it("counts distinct phones across nodes", () => {
    expect(summarizeRevokeOthers([others("n2", ["p1", "p2"]), others("n3", ["p2", "p3"])])).toMatchObject({ status: "done", devices: 3 });
  });

  it("notices a node that refused because of the phone to keep", () => {
    expect(summarizeRevokeOthers([others("n2", ["p1"]), down("n3", "device_not_found")])).toMatchObject({
      status: "partial",
      keepRefused: true,
    });
  });
});

describe("mergeDeviceLists", () => {
  const d = (id: string, extra: Partial<LinkedDevice> = {}): LinkedDevice => ({
    deviceId: id,
    platform: "iOS",
    appVersion: null,
    createdAt: "2026-01-01T00:00:00Z",
    lastSeenAt: "2026-01-02T00:00:00Z",
    ...extra,
  });

  it("unions phones, keeps the latest last-seen, and the earliest revoke with the strongest mode", () => {
    const merged = mergeDeviceLists([
      { node: "n2", ok: true, value: [d("p1", { userRevokedAt: "2026-10-18T10:00:00Z", revokeReason: "lost", revokeMode: "limited" }), d("p2")] },
      { node: "n3", ok: true, value: [d("p1", { lastSeenAt: "2026-10-18T11:00:00Z", userRevokedAt: "2026-10-18T09:00:00Z", revokeMode: "full" }), d("p3")] },
    ]);
    const p1 = merged.devices.find((x) => x.deviceId === "p1")!;
    expect(p1).toMatchObject({ lastSeenAt: "2026-10-18T11:00:00Z", userRevokedAt: "2026-10-18T09:00:00Z", revokeReason: "lost", revokeMode: "full" });
    expect(merged.devices.map((x) => x.deviceId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(merged).toMatchObject({ incomplete: false, failed: false });
  });

  it("is incomplete with a node down and failed with none", () => {
    expect(mergeDeviceLists([{ node: "n2", ok: true, value: [d("p1")] }, down("n3")])).toMatchObject({ incomplete: true, failed: false });
    expect(mergeDeviceLists([down("n2"), down("n3")])).toMatchObject({ failed: true, devices: [] });
  });
});
