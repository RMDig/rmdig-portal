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
  testAlert: {
    requestedAt: "2026-11-11T16:00:00.000Z",
    expired: false,
    configuredNodes: ["avserv-2.rmdig.ai"],
    nodes: [
      {
        node: "avserv-2.rmdig.ai",
        testId: "t1",
        error: null,
        portal: "delivered",
        email: "accepted",
        portalArrived: true,
        portalReceived: true,
        emailConfirmed: true,
      },
    ],
  },
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
  it("passes every item for a complete team whose test reached it on both paths", () => {
    const items = byId(judgeChecklist(facts, answers));
    for (const id of ["callback", "channels", "test_alert", "terms_area"]) expect(items[id]!.status).toBe("pass");
    expect(items.test_alert!.detail).toBe("Received on both paths from avserv-2.rmdig.ai");
    expect(checklistReady(judgeChecklist(facts, answers))).toBe(true);
  });

  it("fails item 3 until the test is proved, saying what's missing", () => {
    const unproved = { ...facts, testAlert: { ...facts.testAlert, nodes: [{ ...facts.testAlert.nodes[0]!, emailConfirmed: false }] } };
    const item = byId(judgeChecklist(unproved, answers)).test_alert!;
    expect(item.status).toBe("fail");
    expect(item.detail).toBe("avserv-2.rmdig.ai email: code not yet entered");
    expect(checklistReady(judgeChecklist(unproved, answers))).toBe(false);
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
    expect(checklistReady([...items.slice(1), { ...items[0]!, status: "fail" as const }])).toBe(false);
  });

  it("records a beta single review with the answers, facts and items", () => {
    const items = judgeChecklist(facts, answers);
    expect(checklistRecord(facts, answers, items)).toEqual({ version: 2, reviewMode: "beta_single", items, answers, facts });
  });
});
