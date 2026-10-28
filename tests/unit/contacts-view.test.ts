import { describe, expect, it } from "vitest";

import { contactRow, contactsSummary } from "@/app/(portal)/settings/contacts/contacts-view";
import type { Contact } from "@/lib/avserv/contacts";

// What /settings/contacts says per contact and for the list (AvServ plan 63 A10).

const BASE: Contact = {
  contactId: "c-1",
  name: "Jane",
  phoneLast4: "0101",
  hasEmail: false,
  acceptance: "pending",
  acceptedAt: null,
  lastIntroAt: null,
};

const as = (acceptance: string, extra: Partial<Contact> = {}): Contact => ({ ...BASE, acceptance, ...extra });

describe("contactRow", () => {
  it("shows only the masked phone, and whether an email is on file", () => {
    expect(contactRow(BASE).reach).toBe("Phone ending 0101");
    expect(contactRow(as("pending", { hasEmail: true })).reach).toBe("Phone ending 0101 · email on file");
  });

  it("marks only accepted as accepted, with when they replied", () => {
    const r = contactRow(as("accepted", { acceptedAt: "2026-10-28T15:04:05Z" }));
    expect(r).toMatchObject({ accepted: true, status: "Accepted" });
    expect(r.detail).toMatch(/^Replied YES .+\.$/);
    for (const s of ["pending", "declined", "opted_out", "unreachable", "paused"]) {
      expect(contactRow(as(s)).accepted).toBe(false);
    }
  });

  it("says when a pending contact was asked, or that they haven't been", () => {
    expect(contactRow(as("pending", { lastIntroAt: "2026-10-28T14:58:00Z" })).detail).toMatch(/^Asked .+ replying YES/);
    expect(contactRow(as("pending")).detail).toMatch(/^Not asked yet/);
  });

  it("labels every §3.17 state, and an unknown one as not accepted", () => {
    expect(contactRow(as("declined")).status).toBe("Declined");
    expect(contactRow(as("opted_out")).status).toBe("Opted out");
    expect(contactRow(as("unreachable")).status).toBe("Can't be reached");
    expect(contactRow(as("paused"))).toMatchObject({ status: "Not accepted", detail: "Hasn't accepted." });
  });

  it("never renders a blank name", () => {
    expect(contactRow(as("pending", { name: "" })).name).toBe("Unnamed contact");
  });
});

describe("contactsSummary", () => {
  it("is not ready with no contacts", () => {
    expect(contactsSummary([])).toEqual({ ready: false, text: expect.stringMatching(/haven't added/) });
  });

  it("is not ready when none has accepted", () => {
    expect(contactsSummary([as("pending")])).toEqual({ ready: false, text: "Your contact hasn't accepted yet." });
    expect(contactsSummary([as("pending"), as("declined")]).text).toBe("None of your 2 contacts has accepted yet.");
  });

  it("is ready with one accepted, and counts them", () => {
    expect(contactsSummary([as("accepted")])).toEqual({ ready: true, text: "Your contact has accepted." });
    expect(contactsSummary([as("accepted"), as("pending")]).text).toBe("1 of your 2 contacts has accepted.");
    expect(contactsSummary([as("accepted"), as("accepted"), as("pending")]).text).toBe("2 of your 3 contacts have accepted.");
    expect(contactsSummary([as("accepted"), as("accepted")]).text).toBe("All 2 of your contacts have accepted.");
  });
});
