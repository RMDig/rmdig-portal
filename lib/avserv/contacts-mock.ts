import type { ContactPage } from "./contacts-types";

// In-process stand-in for AvServ's contacts read under AVSERV_BASE_URL=mock://*
// (local dev and the E2E gate): every account has one accepted contact and one
// still waiting for YES, so the page's two common rows render. Fixed values,
// so the E2E can assert them.

export async function listContactsPage(accountId: string): Promise<ContactPage> {
  const id = accountId.slice(0, 8);
  return {
    contacts: [
      {
        contactId: `mock-${id}-1`,
        name: "Jane Alder",
        phoneLast4: "0101",
        hasEmail: true,
        acceptance: "accepted",
        acceptedAt: "2026-10-28T15:04:05Z",
        lastIntroAt: "2026-10-28T14:58:00Z",
      },
      {
        contactId: `mock-${id}-2`,
        name: "Sam Rivera",
        phoneLast4: "0102",
        hasEmail: false,
        acceptance: "pending",
        acceptedAt: null,
        lastIntroAt: "2026-10-28T14:58:00Z",
      },
    ],
  };
}
