import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/sar/intake against sar_portal_intake.md §3: 2xx/409 delivered,
// other 4xx permanent, 5xx retryable. Stored before answering 2xx; member
// email never changes the answer.

const SECRET = "s".repeat(64);
const h = vi.hoisted(() => ({
  env: { AVSERV_SAR_INTAKE_KEYS: "", NEXTAUTH_URL: "https://rmdig.ai" } as Record<string, string | undefined>,
  team: [{ name: "Summit SAR", status: "approved" }] as unknown[],
  inserted: [{ messageId: "m1" }] as unknown[],
  copies: [{ id: "m1" }] as unknown[],
  members: [{ email: "lead@sar.org" }, { email: "disp@sar.org" }] as unknown[],
  insertedValues: [] as unknown[],
  dbError: null as unknown,
  email: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/email/send", () => ({ sendSarAlertNotifyEmail: h.email }));
vi.mock("@/lib/db", () => {
  let n = 0;
  const select = () => {
    const idx = n++;
    const result = () => {
      if (h.dbError) return Promise.reject(h.dbError);
      // 1st: team lookup; then (for alerts) copies lookup; then members.
      return Promise.resolve(idx % 3 === 0 ? h.team : idx % 3 === 1 ? h.copies : h.members);
    };
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.limit = () => result();
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej);
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
      __reset: () => (n = 0),
    },
  };
});

import { POST } from "@/app/api/sar/intake/route";
import { db } from "@/lib/db";

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
  (db as unknown as { __reset: () => void }).__reset();
  h.env.AVSERV_SAR_INTAKE_KEYS = `sarintake-avserv-2-1:${SECRET}`;
  h.team = [{ name: "Summit SAR", status: "approved" }];
  h.inserted = [{ messageId: "m1" }];
  h.copies = [{ id: "m1" }];
  h.insertedValues = [];
  h.dbError = null;
  h.email.mockResolvedValue(undefined);
});

describe("POST /api/sar/intake", () => {
  it("stores a signed alert, answers 200 and emails every member (no details in the email)", async () => {
    const res = await POST(request(payload()));
    expect(res.status).toBe(200);
    expect(h.insertedValues[0]).toMatchObject({ messageId: "m1", alertId: "sub:team", orgId: ORG, kind: "overdue", node: "avserv-2", drill: false });
    expect(h.email).toHaveBeenCalledTimes(2);
    expect(h.email).toHaveBeenCalledWith("lead@sar.org", { teamName: "Summit SAR", kind: "overdue", alertsUrl: `https://rmdig.ai/sar/${ORG}/alerts` });
  });

  it("answers 409 duplicate for a repeated messageId (AvServ treats it as delivered)", async () => {
    h.inserted = [];
    const res = await POST(request(payload()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "duplicate" });
    expect(h.email).not.toHaveBeenCalled();
  });

  it("doesn't email again for the other node's copy, or for drills and duplicate notices", async () => {
    h.copies = [{ id: "m1" }, { id: "m2" }];
    expect((await POST(request(payload()))).status).toBe(200);
    expect(h.email).not.toHaveBeenCalled();
    h.copies = [{ id: "m1" }];
    expect((await POST(request(payload({ drill: true })))).status).toBe(200);
    expect((await POST(request(payload({ kind: "duplicate_disclaimer", alert: { refersTo: "sub:team", deliveries: 2 } })))).status).toBe(200);
    expect(h.email).not.toHaveBeenCalled();
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

  it("still answers 200 when member email fails, and logs it", async () => {
    h.email.mockRejectedValue(new Error("resend down"));
    expect((await POST(request(payload()))).status).toBe(200);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.intake.member_email_failed" }));
  });
});
