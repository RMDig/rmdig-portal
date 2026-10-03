import { describe, expect, it } from "vitest";

import { changeRoleSchema, checkMembershipChange, revokeInviteSchema, type Member } from "@/lib/sar/membership";

// SAR membership rules (docs/plans/33): any change must leave at least one
// admin; removing yourself is "left", anyone else "removed".

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const team: Member[] = [
  { userId: A, role: "admin" },
  { userId: B, role: "dispatcher" },
  { userId: C, role: "responder" },
];

describe("checkMembershipChange", () => {
  it("changes a member's role and reports the old one", () => {
    expect(checkMembershipChange(team, { kind: "role", userId: C, toRole: "dispatcher" }, A)).toEqual({
      ok: true,
      fromRole: "responder",
      action: "role_changed",
    });
  });

  it("refuses to demote or remove the last admin, including yourself", () => {
    expect(checkMembershipChange(team, { kind: "role", userId: A, toRole: "responder" }, A)).toMatchObject({ ok: false });
    expect(checkMembershipChange(team, { kind: "remove", userId: A }, A)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at least one admin/),
    });
  });

  it("lets an admin leave once someone else is an admin", () => {
    const twoAdmins: Member[] = [...team, { userId: "44444444-4444-4444-8444-444444444444", role: "admin" }];
    expect(checkMembershipChange(twoAdmins, { kind: "remove", userId: A }, A)).toMatchObject({ ok: true, action: "left" });
  });

  it("calls removing someone else 'removed'", () => {
    expect(checkMembershipChange(team, { kind: "remove", userId: B }, A)).toMatchObject({ ok: true, action: "removed", fromRole: "dispatcher" });
  });

  it("refuses non-members and no-op role changes", () => {
    expect(checkMembershipChange(team, { kind: "remove", userId: "nobody" }, A)).toMatchObject({ ok: false });
    expect(checkMembershipChange(team, { kind: "role", userId: B, toRole: "dispatcher" }, A)).toMatchObject({ ok: false });
  });
});

describe("schemas", () => {
  it("accept valid input and reject bad ids or roles", () => {
    expect(changeRoleSchema.safeParse({ userId: A, role: "admin" }).success).toBe(true);
    expect(changeRoleSchema.safeParse({ userId: A, role: "owner" }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ userId: "x", role: "admin" }).success).toBe(false);
    expect(revokeInviteSchema.safeParse({ invitationId: "x" }).success).toBe(false);
  });
});
