import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/sar/intake against sar_portal_intake.md §3: 2xx/409 delivered,
// other 4xx permanent, 5xx retryable. Stored before answering 2xx; the team
// email (lib/sar/alert-notify, tested in sar-alert-notify.test.ts) follows
// and never changes the answer.

const SECRET = "s".repeat(64);
const h = vi.hoisted(() => ({
  env: { AVSERV_SAR_INTAKE_KEYS: "", NEXTAUTH_URL: "https://rmdig.ai" } as Record<string, string | undefined>,
  team: [{ name: "Summit SAR", status: "approved" }] as unknown[],
  inserted: [{ messageId: "m1" }] as unknown[],
  insertedValues: [] as unknown[],
  dbError: null as unknown,
  notify: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  capture: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.capture, captureMessage: h.captureMessage }));
vi.mock("@/lib/sar/alert-notify", () => ({ notifyOnIntake: h.notify }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const result = () => (h.dbError ? Promise.reject(h.dbError) : Promise.resolve(h.team));
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.limit = () => result();
    return c;
  };
  return {
    db: {
      select,
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              h.insertedValues.push(v);
              return Promise.resolve(h.inserted);
            },
          }),
        }),
      }),
    },
  };
});

import { POST as POST_DRILL } from "@/app/api/sar/intake/drill/route";
import { POST } from "@/app/api/sar/intake/route";

const ORG = "11111111-1111-4111-8111-111111111111";
const payload = (o: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  messageId: "m1",
  alertId: "sub:team",
  kind: "overdue",
  teamId: ORG,
  capability: "checkout_alerts",
  node: "avserv-2",
  sentAt: "2026-10-04T10:00:00Z",
  drill: false,
  alert: { checkoutId: "c", userDisplayName: "Pat", lastFix: null, plannedRoute: null, expectedReturnAt: "2026-10-04T09:00:00Z", alertedAt: "2026-10-04T10:00:00Z" },
  ...o,
});
function request(body: object, o: { keyId?: string; t?: number; secret?: string; idem?: string; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(body);
  const t = o.t ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", o.secret ?? SECRET).update(`${t}.${raw}`).digest("hex");
  return new Request("https://rmdig.ai/api/sar/intake", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-avai-node": "avserv-2",
      "x-avai-key-id": o.keyId ?? "sarintake-avserv-2-1",
      "x-avai-signature": `t=${t},v1=${sig}`,
      "idempotency-key": o.idem ?? (body as { messageId?: string }).messageId ?? "",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.env.AVSERV_SAR_INTAKE_KEYS = `sarintake-avserv-2-1:${SECRET}`;
  h.team = [{ name: "Summit SAR", status: "approved" }];
  h.inserted = [{ messageId: "m1" }];
  h.insertedValues = [];
  h.dbError = null;
  h.notify.mockResolvedValue(undefined);
});

describe("POST /api/sar/intake", () => {
  it("stores a signed alert, answers 200 and hands it to the team email", async () => {
    const res = await POST(request(payload()));
    expect(res.status).toBe(200);
    expect(h.insertedValues[0]).toMatchObject({ messageId: "m1", alertId: "sub:team", orgId: ORG, kind: "overdue", node: "avserv-2", drill: false });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ messageId: "m1", alertId: "sub:team", teamId: ORG, kind: "overdue" }));
  });

  it("answers 409 duplicate for a repeated messageId without emailing (AvServ treats it as delivered)", async () => {
    h.inserted = [];
    const res = await POST(request(payload()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "duplicate" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("reports an alert for a team that isn't active to Sentry, and still stores it", async () => {
    h.team = [{ name: "Summit SAR", status: "suspended" }];
    expect((await POST(request(payload()))).status).toBe(200);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tags: { event: "sar.intake.team_not_active" } }));
  });

  it("keeps drills and live alerts apart: each URL refuses the other kind (permanent 4xx)", async () => {
    const onLive = await POST(request(payload({ drill: true })));
    expect(onLive.status).toBe(400);
    expect(await onLive.json()).toEqual({ code: "drill_on_live_intake" });
    const onDrill = await POST_DRILL(request(payload()));
    expect(onDrill.status).toBe(400);
    expect(await onDrill.json()).toEqual({ code: "live_on_drill_intake" });
    expect(h.insertedValues).toEqual([]);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.intake.wrong_url", code: "drill_on_live_intake" }));
  });

  it("stores a drill from the drill URL as a drill, emailing no one", async () => {
    expect((await POST_DRILL(request(payload({ drill: true })))).status).toBe(200);
    expect(h.insertedValues[0]).toMatchObject({ messageId: "m1", drill: true });
  });

  it("accepts an alert whose fix has no time (stored, emailed), and one with a broken detail, logging the drop", async () => {
    const noTime = payload({ alert: { checkoutId: "c", userDisplayName: "Pat", lastFix: { lat: 39.6, lon: -106, accuracyMeters: null, at: null }, plannedRoute: null, expectedReturnAt: "2026-10-04T09:00:00Z", alertedAt: "2026-10-04T10:00:00Z" } });
    expect((await POST(request(noTime))).status).toBe(200);
    expect(h.insertedValues[0]).toMatchObject({ messageId: "m1" });
    h.inserted = [{ messageId: "m2" }];
    const broken = payload({ messageId: "m2", alert: { checkoutId: "c", userDisplayName: "Pat", lastFix: { lat: "x" }, plannedRoute: null, expectedReturnAt: "2026-10-04T09:00:00Z", alertedAt: "2026-10-04T10:00:00Z" } });
    expect((await POST(request(broken))).status).toBe(200);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.intake.fields_dropped", fields: ["lastFix"] }));
  });

  it("rejects bad signatures permanently (401), with the reason", async () => {
    expect(await (await POST(request(payload(), { keyId: "unknown" }))).json()).toEqual({ code: "unknown_key" });
    expect((await POST(request(payload(), { t: Math.floor(Date.now() / 1000) - 301 }))).status).toBe(401);
    expect(await (await POST(request(payload(), { secret: "x".repeat(64) }))).json()).toEqual({ code: "bad_signature" });
    expect(h.insertedValues).toEqual([]);
  });

  it("rejects a bad payload, a mismatched Idempotency-Key and an unknown team (4xx, not retried)", async () => {
    expect((await POST(request({ nope: true }, { idem: "x" }))).status).toBe(400);
    expect(await (await POST(request(payload(), { idem: "other" }))).json()).toEqual({ code: "idempotency_key_mismatch" });
    h.team = [];
    expect((await POST(request(payload()))).status).toBe(404);
  });

  it("answers 503 when no keys are configured, and 500 on a database failure (both retried)", async () => {
    h.env.AVSERV_SAR_INTAKE_KEYS = "";
    expect((await POST(request(payload()))).status).toBe(503);
    h.env.AVSERV_SAR_INTAKE_KEYS = `sarintake-avserv-2-1:${SECRET}`;
    h.dbError = new Error("connection reset");
    expect((await POST(request(payload()))).status).toBe(500);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.intake.failed" }));
  });

  it("answers 500 and reports to Sentry when the store fails (AvServ retries)", async () => {
    h.dbError = new Error("connection reset");
    expect((await POST(request(payload()))).status).toBe(500);
    expect(h.capture).toHaveBeenCalledWith(h.dbError, expect.objectContaining({ tags: { event: "sar.intake.failed" } }));
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("reports missing intake keys to Sentry, not just the log", async () => {
    h.env.AVSERV_SAR_INTAKE_KEYS = "";
    expect((await POST(request(payload()))).status).toBe(503);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tags: { event: "sar.intake.not_configured" } }));
  });
});
