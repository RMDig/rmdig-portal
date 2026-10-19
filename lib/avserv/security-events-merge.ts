import { isKnownKind, type AvServSecurityEvent, type FeedPage } from "./security-events-types";

// One event list from every node's feed (security_events.md §3–§4): the id is
// a UUIDv5 of the action, the same on both nodes, so dedupe on it and keep the
// earliest `at`. Unknown kinds are dropped and counted. Pure; unit-tested.

export interface MergedEvents {
  events: AvServSecurityEvent[];
  unknownDropped: number;
}

export function mergeFeeds(pages: FeedPage["events"][]): MergedEvents {
  const byId = new Map<string, AvServSecurityEvent>();
  let unknownDropped = 0;
  for (const events of pages) {
    for (const e of events) {
      if (!isKnownKind(e.kind)) {
        unknownDropped++;
        continue;
      }
      const prev = byId.get(e.id);
      if (!prev || e.at < prev.at) byId.set(e.id, { id: e.id, kind: e.kind, at: e.at, deviceId: e.deviceId });
    }
  }
  const events = [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  return { events, unknownDropped };
}
