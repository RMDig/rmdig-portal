import { describe, expect, it } from "vitest";

import { evaluateMigrations, type JournalEntry } from "@/lib/db/migration-guard";

// The production-migration guard: every case it must catch, and the ones it
// must let through.

const J: JournalEntry[] = [
  { idx: 0, when: 1000, tag: "0000_init" },
  { idx: 1, when: 2000, tag: "0001_users" },
  { idx: 2, when: 3000, tag: "0002_reviews" },
];

describe("evaluateMigrations", () => {
  it("passes when every migration on the branch is applied", () => {
    const r = evaluateMigrations(J, [1000, 2000, 3000]);
    expect(r.outcome).toBe("pass");
    expect(r.messages[0]).toMatchObject({ level: "info" });
  });

  it("fails on a new migration not yet applied to production (the forgot-to-migrate case)", () => {
    const r = evaluateMigrations(J, [1000, 2000]);
    expect(r.outcome).toBe("fail");
    expect(r.pending).toEqual(["0002_reviews"]);
    expect(r.messages).toContainEqual(expect.objectContaining({ level: "error", text: expect.stringMatching(/0002_reviews/) }));
  });

  it("fails on a migration db:migrate would skip (older than production's latest)", () => {
    // 0001 never ran, but a later one did: drizzle only applies newer entries.
    const r = evaluateMigrations(J, [1000, 3000]);
    expect(r.outcome).toBe("fail");
    expect(r.unreachable).toEqual(["0001_users"]);
    expect(r.pending).toEqual([]);
    expect(r.messages[0]!.text).toMatch(/skip it silently/);
  });

  it("only warns when production has a migration this branch doesn't know", () => {
    const r = evaluateMigrations(J, [1000, 2000, 3000, 4000]);
    expect(r.outcome).toBe("pass");
    expect(r.unknownApplied).toEqual([4000]);
    expect(r.messages).toContainEqual(expect.objectContaining({ level: "warning" }));
  });

  it("treats an empty production as everything pending", () => {
    const r = evaluateMigrations(J, []);
    expect(r.outcome).toBe("fail");
    expect(r.pending).toEqual(["0000_init", "0001_users", "0002_reviews"]);
  });

  it("matches the repo's real journal shape", async () => {
    const { readFileSync } = await import("node:fs");
    const journal = JSON.parse(readFileSync("lib/db/migrations/meta/_journal.json", "utf8")) as {
      entries: JournalEntry[];
    };
    const all = journal.entries.map((e) => e.when);
    expect(evaluateMigrations(journal.entries, all).outcome).toBe("pass");
    expect(new Set(all).size).toBe(all.length);
  });
});
