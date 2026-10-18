import { describe, expect, it } from "vitest";

import { describeUserAgent } from "@/lib/format/user-agent";

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome on Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0", "Firefox on Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1", "Chrome on iPhone"],
  ])("%s → %s", (ua, label) => {
    expect(describeUserAgent(ua)).toBe(label);
  });

  it("says so when it can't tell", () => {
    expect(describeUserAgent(null)).toBe("Unknown browser");
    expect(describeUserAgent("curl/8.4.0")).toBe("Unknown browser");
    expect(describeUserAgent("SomeBot (Linux)")).toBe("A browser on Linux");
  });
});
