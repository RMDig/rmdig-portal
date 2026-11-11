import { describe, expect, it } from "vitest";

import {
  activationAnswersSchema,
  checklistReady,
  checklistRecord,
  judgeChecklist,
  type ActivationFacts,
} from "@/lib/sar/activation-checklist-rules";

// The activation checklist's rules (plan 33 §6.9 G2; owner, 2026-11-11).

const facts: ActivationFacts = {
  oncallEmailVerified: true,
  members: 3,
  admins: 1,
  publishedTermsVersion: 2,
  areaKm2: 840.4,
  largeArea: false,
  testAlert: "pending_avserv",
};
const answers = activationAnswersSchema.parse({ callbackNumber: " +1 970 555 0100 ", callbackSpokeTo: "Sgt. Rivera", termsFloor: "on" });
const byId = (items: ReturnType<typeof judgeChecklist>) => Object.fromEntries(items.map((i) => [i.id, i]));

describe("activationAnswersSchema", () => {
  it("trims the call-back and reads the checkboxes", () => {
    expect(answers).toEqual({ callbackNumber: "+1 970 555 0100", callbackSpokeTo: "Sgt. Rivera", termsFloor: true, largeAreaResolved: false });
    expect(activationAnswersSchema.parse({})).toEqual({ callbackNumber: "", callbackSpokeTo: "", termsFloor: false, largeAreaResolved: false });
  });
});

describe("judgeChecklist", () => {
  it("passes items 1, 2 and 4 for a complete team, and holds item 3 pending (AvServ's test alert)", () => {
    const items = byId(judgeChecklist(facts, answers));
    expect(items.callback!.status).toBe("pass");
    expect(items.channels!.status).toBe("pass");
    expect(items.terms_area!.status).toBe("pass");
    expect(items.test_alert!.status).toBe("pending");
    expect(checklistReady(judgeChecklist(facts, answers))).toBe(false);
  });

  it("fails the call-back without a number and a name", () => {
    expect(byId(judgeChecklist(facts, { ...answers, callbackSpokeTo: "" })).callback!.status).toBe("fail");
    expect(byId(judgeChecklist(facts, { ...answers, callbackNumber: "555" })).callback!.status).toBe("fail");
  });

  it("fails the channels with one member, no admin, or no confirmed on-call email, saying which", () => {
    const item = byId(judgeChecklist({ ...facts, members: 1, admins: 0, oncallEmailVerified: false }, answers)).channels!;
    expect(item.status).toBe("fail");
    expect(item.detail).toBe("1 member (needs 2 or more); no admin; no confirmed on-call email");
  });

  it("fails the terms without published terms or the floor clauses, and a large area until it's resolved", () => {
    expect(byId(judgeChecklist({ ...facts, publishedTermsVersion: null }, answers)).terms_area!.detail).toContain("no published terms");
    expect(byId(judgeChecklist(facts, { ...answers, termsFloor: false })).terms_area!.status).toBe("fail");
    const large = { ...facts, areaKm2: 15_000, largeArea: true };
    expect(byId(judgeChecklist(large, answers)).terms_area!.detail).toContain("large-area warning not resolved");
    expect(byId(judgeChecklist(large, { ...answers, largeAreaResolved: true })).terms_area!.status).toBe("pass");
  });
});

describe("checklistReady and checklistRecord", () => {
  it("is ready only when every item passes", () => {
    const items = judgeChecklist(facts, answers).map((i) => ({ ...i, status: "pass" as const }));
    expect(checklistReady(items)).toBe(true);
    expect(checklistReady([...items.slice(1), { ...items[0]!, status: "pending" as const }])).toBe(false);
  });

  it("records a beta single review with the answers, facts and items", () => {
    const items = judgeChecklist(facts, answers);
    expect(checklistRecord(facts, answers, items)).toEqual({ version: 1, reviewMode: "beta_single", items, answers, facts });
  });
});
