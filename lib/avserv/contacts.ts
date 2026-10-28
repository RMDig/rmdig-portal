import * as mock from "./contacts-mock";
import { type Contact, ContactPageSchema } from "./contacts-types";
import { AvServContractError, callWithFailover, contractBaseUrl, isMock } from "./request";

export * from "./contacts-types";

// S2S client for an account's contacts and whether each has accepted (plan 05
// P-B4, AvServ plan 63 A10). Read-only: adding, removing and resending a
// contact stay in the app. It reads what one node holds, so a YES that hasn't
// replicated there yet reads `pending` for a few seconds.

const PURPOSE = "account contacts";

// AvServ's max page. Accounts hold a handful of contacts, so one page is the
// norm; the page cap only stops a cursor that never ends from looping forever.
const PAGE_LIMIT = 500;
const MAX_PAGES = 20;

/** Every contact on the account, in AvServ's order (by contactId). An account
 *  with none is an empty list; an unknown or deleted account throws 404
 *  account_not_found. */
export async function listContacts(accountId: string): Promise<Contact[]> {
  const primary = contractBaseUrl(PURPOSE);
  if (isMock(primary)) return (await mock.listContactsPage(accountId)).contacts;

  const base = `/v1/internal/accounts/${encodeURIComponent(accountId)}/contacts`;
  const contacts: Contact[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) query.set("cursor", cursor);
    const body = await callWithFailover(primary, `${base}?${query}`, { method: "GET" }, ContactPageSchema, "contacts");
    contacts.push(...body.contacts);
    if (!body.nextCursor) return contacts;
    if (body.nextCursor === cursor) {
      throw new AvServContractError("AvServ contacts cursor did not advance");
    }
    cursor = body.nextCursor;
  }
  throw new AvServContractError(`AvServ contacts did not end within ${MAX_PAGES} pages`);
}
