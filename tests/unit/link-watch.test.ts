import { describe, expect, it } from "vitest";

import { codeStillLive, groupLinkCode, LINK_POLL_MS, newlyLinked } from "@/app/(portal)/settings/link-watch";

const ios = { deviceId: "dev-ios", platform: "iOS" };
const android = { deviceId: "dev-android", platform: "Android" };

describe("newlyLinked", () => {
  it("finds the device that wasn't there when the code was generated", () => {
    expect(newlyLinked(["dev-ios"], [ios, android])).toEqual(android);
  });

  it("finds nothing while the list is unchanged", () => {
    expect(newlyLinked(["dev-ios"], [ios])).toBeNull();
  });

  it("finds the first device on an account that had none", () => {
    expect(newlyLinked([], [ios])).toEqual(ios);
  });

  it("finds nothing when the list couldn't load, or no code has been requested", () => {
    expect(newlyLinked(["dev-ios"], null)).toBeNull();
    expect(newlyLinked(null, [ios, android])).toBeNull();
  });
});

describe("codeStillLive", () => {
  const expiresAt = "2026-10-18T17:12:00.000Z";
  const t = new Date(expiresAt).getTime();

  it("is live until the code expires, and not after", () => {
    expect(codeStillLive(expiresAt, t - 1)).toBe(true);
    expect(codeStillLive(expiresAt, t)).toBe(false);
  });

  it("treats an unreadable expiry as expired, so polling stops", () => {
    expect(codeStillLive("not-a-date", 0)).toBe(false);
  });

  it("polls at most 120 times over a 10-minute code", () => {
    expect((10 * 60 * 1000) / LINK_POLL_MS).toBe(120);
  });
});

describe("groupLinkCode", () => {
  it("groups AvServ's 8-character code", () => {
    expect(groupLinkCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("leaves an already grouped or unexpected code alone", () => {
    expect(groupLinkCode("ABCD-2345")).toBe("ABCD-2345");
    expect(groupLinkCode("ABC")).toBe("ABC");
  });
});
