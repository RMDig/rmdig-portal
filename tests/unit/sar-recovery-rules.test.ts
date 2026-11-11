import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { readRemedy, REMEDIES } from "@/lib/avserv/sar-teams";
import { REMEDY_COPY, shouldNotify, shouldShow, waitingText } from "@/lib/sar/recovery-rules";
import { FORBIDDEN_PUBLIC_PHRASES } from "@/lib/legal/compliance-copy";

// What a team is told when an AvAI server can't send it alerts, and when its
// admins are emailed (plan 33 §6.9 F4; AvServ sar_team_sync.md §5.4).

const node = (o: Partial<{ remedy: (typeof REMEDIES)[number] | null; remedyNotified: string | null }> = {}) => ({
  node: "avserv-2",
  remedy: "reverify_channel" as (typeof REMEDIES)[number] | null,
  waitingAlerts: 2,
  remedyNotified: null as string | null,
  ...o,
});

describe("readRemedy", () => {
  it("keeps every remedy the contract names, null while usable, and reads an unknown one as contact_staff", () => {
    for (const r of REMEDIES) expect(readRemedy(r, { node: "n", orgId: "o" })).toBe(r);
    expect(readRemedy(null, { node: "n", orgId: "o" })).toBeNull();
    expect(readRemedy(undefined, { node: "n", orgId: "o" })).toBeNull();
    expect(readRemedy("move_to_mars", { node: "n", orgId: "o" })).toBe("contact_staff");
  });
});

describe("REMEDY_COPY", () => {
  it("words every remedy, links only the pages a team admin fixes it on, and makes no forbidden claim", () => {
    for (const r of REMEDIES) {
      const c = REMEDY_COPY[r];
      expect(c.text.length).toBeGreaterThan(20);
      for (const p of FORBIDDEN_PUBLIC_PHRASES) expect(c.text.toLowerCase()).not.toContain(p.toLowerCase());
    }
    expect(REMEDY_COPY.reverify_channel.page).toBe("terms");
    expect(REMEDY_COPY.update_terms.page).toBe("terms");
    expect(REMEDY_COPY.undo_leaving.page).toBe("leave");
    expect(REMEDY_COPY.contact_staff.page).toBeNull();
    expect(waitingText(1)).toBe("This server is holding 1 alert for your team until this is fixed; it is sent as soon as it is.");
    expect(waitingText(3)).toContain("3 alerts");
  });
});

describe("shouldNotify and shouldShow", () => {
  it("emails an active team's admins about a new remedy, once", () => {
    expect(shouldNotify("approved", node())).toBe(true);
    expect(shouldNotify("approved", node({ remedyNotified: "reverify_channel" }))).toBe(false);
    expect(shouldNotify("approved", node({ remedyNotified: "update_terms" }))).toBe(true);
    expect(shouldNotify("approved", node({ remedy: null }))).toBe(false);
  });

  it("never for the notice a leaving team gave itself, nor a team staff suspended, withdrew or haven't approved", () => {
    expect(shouldNotify("leaving", node({ remedy: "undo_leaving" }))).toBe(false);
    expect(shouldNotify("leaving", node({ remedy: "reverify_channel" }))).toBe(true);
    for (const s of ["suspended", "withdrawn", "pending", "rejected"]) expect(shouldNotify(s, node({ remedy: "contact_staff" }))).toBe(false);
    expect(shouldShow("approved", "resync")).toBe(true);
    expect(shouldShow("leaving", "undo_leaving")).toBe(false);
    expect(shouldShow("suspended", "contact_staff")).toBe(false);
  });
});
