import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/sar/alert-notify: the team email for an alert goes once, whichever node's
// copy arrives first; a failed send is retried (by the other copy or the cron)
// without re-emailing anyone who got it; after MAX_ATTEMPTS it is given up
// loudly. The store is an in-memory model of lib/sar/alert-notify-store with
// the same claim rules (its SQL is exercised against Postgres in
// tests/integration/sar-alert-notify-store.test.ts).

interface Row {
  orgId: string;
  alertId: string;
  kind: string;
  messageId: string;
  status: string;
  attempts: number;
  leasedUntil: Date | null;
  deliveredUserIds: string[];
  lastError: string | null;
}

const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  ended: false,
  members: [] as Array<{ userId: string; email: string }>,
  email: vi.fn(),
  capture: vi.fn(),
  captureMessage: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const k = (x: { orgId: string; alertId: string; kind: string }) => `${x.orgId}|${x.alertId}|${x.kind}`;
const claimOf = (r: Row) => ({ orgId: r.orgId, alertId: r.alertId, kind: r.kind, attempts: r.attempts, deliveredUserIds: [...r.deliveredUserIds] });
// Every store call yields first, as a database round trip would, so two
// handlers really interleave.
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock("@/lib/sar/alert-notify-store", () => ({
  claimNew: async (key: Row, messageId: string, now: Date, leaseMs: number) => {
    await tick();
    if (h.rows.has(k(key))) return null;
    const row: Row = { ...key, messageId, status: "pending", attempts: 1, leasedUntil: new Date(now.getTime() + leaseMs), deliveredUserIds: [], lastError: null };
    h.rows.set(k(key), row);
    return claimOf(row);
  },
  claimRetry: async (key: Row, now: Date, leaseMs: number) => {
    await tick();
    const row = h.rows.get(k(key));
    if (!row || !["pending", "failed"].includes(row.status) || (row.leasedUntil && row.leasedUntil >= now)) return null;
    row.attempts += 1;
    row.leasedUntil = new Date(now.getTime() + leaseMs);
    return claimOf(row);
  },
  recordAttempt: async (claim: Row, o: { status: string; deliveredUserIds: string[]; lastError: string | null }) => {
    await tick();
    const row = h.rows.get(k(claim));
    if (!row || row.attempts !== claim.attempts) return false;
    Object.assign(row, { status: o.status, deliveredUserIds: o.deliveredUserIds, lastError: o.lastError, leasedUntil: null });
    return true;
  },
  notifyContext: async () => ({ teamName: "Summit SAR", capability: "checkout_alerts" }),
  alertEnded: async () => h.ended,
  recipients: async () => h.members,
  dueForRetry: async (now: Date) =>
    [...h.rows.values()].filter((r) => ["pending", "failed"].includes(r.status) && (!r.leasedUntil || r.leasedUntil < now)),
}));
vi.mock("@/lib/email/send", () => ({ sendSarAlertNotifyEmail: h.email }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://rmdig.ai" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.capture, captureMessage: h.captureMessage }));

import { LEASE_MS, MAX_ATTEMPTS, emailsTeam, notifyOnIntake, retryAlertNotifications } from "@/lib/sar/alert-notify";
import type { IntakePayload } from "@/lib/sar/intake";

const ORG = "11111111-1111-4111-8111-111111111111";
const T0 = new Date("2026-10-07T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);
const alert = (o: Partial<IntakePayload> = {}) =>
  ({ messageId: "m-avserv-2", alertId: "sub:team", teamId: ORG, kind: "overdue", capability: "checkout_alerts", drill: false, ...o }) as IntakePayload;
const sentTo = () => h.email.mock.calls.map((c) => c[0] as string).sort();

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.ended = false;
  h.members = [
    { userId: "u-lead", email: "lead@sar.org" },
    { userId: "u-disp", email: "disp@sar.org" },
  ];
  h.email.mockResolvedValue(undefined);
});

describe("notifyOnIntake", () => {
  it("emails each admin and dispatcher once, linking the alerts page and saying nothing of the alert", async () => {
    await notifyOnIntake(alert(), T0);
    expect(sentTo()).toEqual(["disp@sar.org", "lead@sar.org"]);
    expect(h.email).toHaveBeenCalledWith("lead@sar.org", { teamName: "Summit SAR", kind: "overdue", fromAreaUser: false, alertsUrl: `https://rmdig.ai/sar/${ORG}/alerts` });
    expect(h.rows.get(`${ORG}|sub:team|overdue`)).toMatchObject({ status: "sent", attempts: 1, deliveredUserIds: ["u-lead", "u-disp"] });
  });

  it("sends exactly once when both nodes' copies arrive at the same moment", async () => {
    await Promise.all([notifyOnIntake(alert(), T0), notifyOnIntake(alert({ messageId: "m-avserv-3" }), T0)]);
    expect(sentTo()).toEqual(["disp@sar.org", "lead@sar.org"]);
  });

  it("sends exactly once when the other copy arrives after the email went", async () => {
    await notifyOnIntake(alert(), T0);
    await notifyOnIntake(alert({ messageId: "m-avserv-3" }), later(1000));
    expect(h.email).toHaveBeenCalledTimes(2);
  });

  it("emails an update (all-clear) separately from its alert, once", async () => {
    await notifyOnIntake(alert(), T0);
    await notifyOnIntake(alert({ messageId: "c2", kind: "all_clear" }), T0);
    await notifyOnIntake(alert({ messageId: "c3", kind: "all_clear" }), T0);
    expect(h.email.mock.calls.filter((c) => (c[1] as { kind: string }).kind === "all_clear")).toHaveLength(2);
  });

  it("doesn't email for drills or duplicate notices", async () => {
    expect(emailsTeam({ drill: true, kind: "overdue" })).toBe(false);
    expect(emailsTeam({ drill: false, kind: "duplicate_disclaimer" })).toBe(false);
    await notifyOnIntake(alert({ drill: true }), T0);
    await notifyOnIntake(alert({ kind: "duplicate_disclaimer" }), T0);
    expect(h.email).not.toHaveBeenCalled();
    expect(h.rows.size).toBe(0);
  });

  it("leaves a failed send owed, and the other node's copy retries it for only the member who missed it", async () => {
    h.email.mockImplementation((to: string) => (to === "disp@sar.org" ? Promise.reject(new Error("resend down")) : Promise.resolve()));
    await notifyOnIntake(alert(), T0);
    expect(h.rows.get(`${ORG}|sub:team|overdue`)).toMatchObject({ status: "failed", attempts: 1, deliveredUserIds: ["u-lead"] });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.notify.failed", undelivered: 1 }));

    h.email.mockClear().mockResolvedValue(undefined);
    await notifyOnIntake(alert({ messageId: "m-avserv-3" }), later(1000));
    expect(sentTo()).toEqual(["disp@sar.org"]);
    expect(h.rows.get(`${ORG}|sub:team|overdue`)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("reports a crash mid-attempt to Sentry and never throws to the intake handler", async () => {
    h.members = null as never; // recipients() resolves to something unusable
    await expect(notifyOnIntake(alert(), T0)).resolves.toBeUndefined();
    expect(h.capture).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { event: "sar.notify.attempt_crashed" } }));
  });

  it("reports a team with no admin or dispatcher to email, and gives up", async () => {
    h.members = [];
    await notifyOnIntake(alert(), T0);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tags: { event: "sar.notify.no_recipients" } }));
    expect(h.rows.get(`${ORG}|sub:team|overdue`)?.status).toBe("abandoned");
  });
});

describe("retryAlertNotifications (the cron)", () => {
  it("retries a failed email, and leaves sent ones alone", async () => {
    await notifyOnIntake(alert({ alertId: "a-ok" }), T0);
    h.email.mockRejectedValueOnce(new Error("resend down")).mockRejectedValueOnce(new Error("resend down"));
    await notifyOnIntake(alert({ alertId: "a-fail" }), T0);
    h.email.mockClear().mockResolvedValue(undefined);

    const summary = await retryAlertNotifications(later(60_000));
    expect(summary).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(sentTo()).toEqual(["disp@sar.org", "lead@sar.org"]);
  });

  it("retries an attempt that died mid-send once its lease is up, not before", async () => {
    // Claimed but never recorded: the function died.
    h.rows.set(`${ORG}|sub:team|overdue`, { orgId: ORG, alertId: "sub:team", kind: "overdue", messageId: "m", status: "pending", attempts: 1, leasedUntil: later(LEASE_MS), deliveredUserIds: [], lastError: null });
    expect((await retryAlertNotifications(later(LEASE_MS - 1))).due).toBe(0);
    expect(h.email).not.toHaveBeenCalled();
    expect(await retryAlertNotifications(later(LEASE_MS + 1))).toMatchObject({ due: 1, sent: 1 });
  });

  it("gives up loudly after MAX_ATTEMPTS", async () => {
    h.email.mockRejectedValue(new Error("resend down"));
    await notifyOnIntake(alert(), T0);
    for (let i = 2; i <= MAX_ATTEMPTS; i++) await retryAlertNotifications(later(i * 60_000));
    const row = h.rows.get(`${ORG}|sub:team|overdue`)!;
    expect(row).toMatchObject({ status: "abandoned", attempts: MAX_ATTEMPTS });
    expect(row.lastError).toMatch(/resend down/);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/Gave up/), expect.objectContaining({ level: "error", tags: { event: "sar.notify.abandoned" } }));
    h.email.mockClear();
    expect((await retryAlertNotifications(later(3_600_000))).due).toBe(0);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("doesn't send a late alert email once the alert has ended (the all-clear tells the team)", async () => {
    h.email.mockRejectedValue(new Error("resend down"));
    await notifyOnIntake(alert(), T0);
    h.email.mockClear();
    h.ended = true;
    expect(await retryAlertNotifications(later(60_000))).toMatchObject({ superseded: 1 });
    expect(h.email).not.toHaveBeenCalled();
  });
});
