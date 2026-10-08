import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEVICE_ID_PREFIX_LENGTH, shortDeviceId } from "@/lib/format/device-id";

describe("shortDeviceId", () => {
  it("shows only a prefix of a full device UUID", () => {
    const id = "3f2c9a71-5b8e-4d0a-9c6f-1e2d3c4b5a69";
    const short = shortDeviceId(id);
    expect(short).toBe("3f2c9a71…");
    expect(short).not.toContain(id.slice(DEVICE_ID_PREFIX_LENGTH));
  });

  it("leaves an ID no longer than the prefix as is", () => {
    expect(shortDeviceId("abc")).toBe("abc");
    expect(shortDeviceId("12345678")).toBe("12345678");
  });

  it("is what the devices list renders, not the raw ID", () => {
    const src = readFileSync(join(process.cwd(), "app", "(portal)", "settings", "devices", "DevicesList.tsx"), "utf8");
    expect(src).toContain("{shortDeviceId(d.deviceId)}");
    expect(src).not.toMatch(/>\{d\.deviceId\}</);
  });
});
