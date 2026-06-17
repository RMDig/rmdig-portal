import { describe, expect, it, vi } from "vitest";

// Stub the db client so importing the schema (which pulls in lib/db for the enum)
// doesn't construct a real postgres client. The DB *schema* (enum values) stays
// real — only the client is stubbed.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  createAdvertiserAccountSchema,
  inviteAdvertiserMemberSchema,
} from "@/lib/advertiser/schema";

const base = {
  name: "Summit Gear Co.",
  contactName: "Sam Rivers",
  contactEmail: "Sam@SummitGear.com",
  tosAccepted: "on",
};

describe("createAdvertiserAccountSchema", () => {
  it("accepts a valid submission and normalizes values", () => {
    const r = createAdvertiserAccountSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.contactEmail).toBe("sam@summitgear.com"); // lowercased
      expect(r.data.tosAccepted).toBe(true);
      expect(r.data.contactPhone).toBeUndefined(); // omitted optional
      expect(r.data.websiteUrl).toBeUndefined();
    }
  });

  it("collapses a blank optional field to undefined", () => {
    const r = createAdvertiserAccountSchema.safeParse({ ...base, contactPhone: "   " });
    expect(r.success && r.data.contactPhone).toBeUndefined();
  });

  it("accepts a valid website URL", () => {
    const r = createAdvertiserAccountSchema.safeParse({
      ...base,
      websiteUrl: "https://summitgear.com",
    });
    expect(r.success && r.data.websiteUrl).toBe("https://summitgear.com");
  });

  it("rejects a malformed website URL", () => {
    expect(
      createAdvertiserAccountSchema.safeParse({ ...base, websiteUrl: "not a url" }).success,
    ).toBe(false);
  });

  it("rejects a missing name", () => {
    expect(createAdvertiserAccountSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects an invalid contact email", () => {
    expect(
      createAdvertiserAccountSchema.safeParse({ ...base, contactEmail: "nope" }).success,
    ).toBe(false);
  });

  it("rejects an unaccepted TOS (checkbox absent)", () => {
    const withoutTos = {
      name: base.name,
      contactName: base.contactName,
      contactEmail: base.contactEmail,
    };
    expect(createAdvertiserAccountSchema.safeParse(withoutTos).success).toBe(false);
  });
});

describe("inviteAdvertiserMemberSchema", () => {
  it("accepts a valid invite and lowercases the email", () => {
    const r = inviteAdvertiserMemberSchema.safeParse({ email: "Ed@Example.com", role: "editor" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("ed@example.com");
  });

  it("accepts the admin role", () => {
    expect(
      inviteAdvertiserMemberSchema.safeParse({ email: "a@b.com", role: "admin" }).success,
    ).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(
      inviteAdvertiserMemberSchema.safeParse({ email: "a@b.com", role: "responder" }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      inviteAdvertiserMemberSchema.safeParse({ email: "nope", role: "editor" }).success,
    ).toBe(false);
  });
});
