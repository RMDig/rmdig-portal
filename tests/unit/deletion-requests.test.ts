import { beforeEach, describe, expect, it, vi } from "vitest";

// Deletion requests up to "confirmed" (plan 35 §1), run against an in-memory
// table. Opening the emailed link changes nothing (mail scanners open links on
// delivery); only typing the address the request was made for confirms it.

const h = vi.hoisted(() => ({ fake: null as null | import("./helpers/fake-db").FakeDb }));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { deletionRequests: fakeTable("deletion_requests") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));

import { checkDeletionLink, confirmDeletionRequest, recordDeletionRequest } from "@/lib/deletion/requests";
import { generateDeletionToken } from "@/lib/legal/deletion-tokens";

import { createFakeDb } from "./helpers/fake-db";

const EMAIL = "pat@example.org";
const rows = () => h.fake!.rows("deletion_requests");

/** What the intake action does: a fresh token, recorded. Returns the link's token. */
async function request(email = EMAIL, expires?: Date): Promise<string> {
  const t = generateDeletionToken();
  const res = await recordDeletionRequest({ email, tokenHash: t.tokenHash, expires: expires ?? t.expires });
  // The fake applies no column defaults; Postgres does.
  const row = rows().at(-1)!;
  if (res.kind === "created" && row.status === undefined) {
    Object.assign(row, { id: `req-${rows().length}-${t.tokenHash.slice(0, 6)}`, status: "pending_confirmation" });
  }
  return t.token;
}

beforeEach(() => {
  h.fake = createFakeDb();
});

describe("recording a request", () => {
  it("keeps one live link per address: a new request replaces the unconfirmed one", async () => {
    const first = await request();
    const second = await request();
    await request("someone-else@example.org");
    expect(rows().filter((r) => r.email === EMAIL)).toHaveLength(1);
    expect((await checkDeletionLink(first)).kind).toBe("invalid");
    expect((await checkDeletionLink(second)).kind).toBe("pending");
  });

  it("adds nothing while a confirmed request for the address is open", async () => {
    const token = await request();
    await confirmDeletionRequest(token, EMAIL);
    const t = generateDeletionToken();
    const res = await recordDeletionRequest({ email: EMAIL, tokenHash: t.tokenHash, expires: t.expires });
    expect(res.kind).toBe("already_open");
    expect(rows()).toHaveLength(1);
  });
});

describe("the emailed link", () => {
  it("opening it changes nothing, however often", async () => {
    const token = await request();
    for (let i = 0; i < 3; i++) expect(await checkDeletionLink(token)).toEqual({ kind: "pending" });
    expect(rows()[0]!.status).toBe("pending_confirmation");
    expect(rows()[0]!.confirmedAt ?? null).toBeNull();
  });

  it("reports an unknown and an expired link", async () => {
    expect((await checkDeletionLink("0".repeat(64))).kind).toBe("invalid");
    const old = await request(EMAIL, new Date(Date.now() - 1000));
    expect((await checkDeletionLink(old)).kind).toBe("expired");
  });
});

describe("confirming", () => {
  it("needs the address the request was made for", async () => {
    const token = await request();
    expect((await confirmDeletionRequest(token, "other@example.org")).kind).toBe("mismatch");
    expect(rows()[0]!.status).toBe("pending_confirmation");

    const res = await confirmDeletionRequest(token, "  Pat@Example.org ");
    expect(res).toMatchObject({ kind: "confirmed", email: EMAIL });
    expect(rows()[0]!.status).toBe("confirmed");
    expect(rows()[0]!.confirmedAt).toBeInstanceOf(Date);
  });

  it("confirms once: a second submit is 'already' (so nobody is notified twice)", async () => {
    const token = await request();
    expect((await confirmDeletionRequest(token, EMAIL)).kind).toBe("confirmed");
    expect((await confirmDeletionRequest(token, EMAIL)).kind).toBe("already");
    expect((await checkDeletionLink(token)).kind).toBe("confirmed");
  });

  it("refuses an expired or unknown link", async () => {
    const old = await request(EMAIL, new Date(Date.now() - 1000));
    expect((await confirmDeletionRequest(old, EMAIL)).kind).toBe("expired");
    expect((await confirmDeletionRequest("0".repeat(64), EMAIL)).kind).toBe("invalid");
    expect(rows()[0]!.status).toBe("pending_confirmation");
  });
});
