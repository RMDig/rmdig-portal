// How the link card notices that the code it showed was used. The page lists the
// account's devices; the card remembers the ids that were there when the code
// was generated and looks for one that wasn't. Pure, so it's unit-tested.

export interface DeviceSummary {
  deviceId: string;
  platform: string;
}

/** Every 5 s while a code is live: 120 page refreshes at most per 10-minute code. */
export const LINK_POLL_MS = 5_000;

/** The first device in `devices` that isn't in `baseline`, or null. A null list
 *  (the page couldn't load devices this time) or no baseline finds nothing. */
export function newlyLinked(
  baseline: readonly string[] | null,
  devices: readonly DeviceSummary[] | null,
): DeviceSummary | null {
  if (!baseline || !devices) return null;
  return devices.find((d) => !baseline.includes(d.deviceId)) ?? null;
}

/** Keep refreshing only while the code can still be used. */
export function codeStillLive(expiresAt: string, now: number): boolean {
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && now < t;
}
