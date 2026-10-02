import * as mock from "./restrictions-mock";
import {
  type LiftInput,
  type Restriction,
  RestrictionListSchema,
  RestrictionSchema,
} from "./restrictions-types";
import {
  type AvServContractError,
  callWithFailover,
  contractBaseUrl,
  isMock,
  retryableOnOtherNode,
} from "./request";

export * from "./restrictions-types";

// S2S client for AvServ account restrictions (contract restrictions.md rev 1;
// docs/plans/32). AvServ is the system of record. Every call is
// account-scoped: no restriction is ever looked up by its id alone (§8).

const PURPOSE = "account restrictions";

const restrictionsPath = (accountId: string) =>
  `/v1/internal/accounts/${encodeURIComponent(accountId)}/restrictions`;

/** GET …/restrictions (§2): every restriction the account has had, newest
 *  first. An account with none is an empty list, never an error. */
export async function listRestrictions(accountId: string): Promise<Restriction[]> {
  const primary = contractBaseUrl(PURPOSE);
  if (isMock(primary)) return mock.listRestrictions(accountId);

  const body = await callWithFailover(
    primary,
    restrictionsPath(accountId),
    { method: "GET" },
    RestrictionListSchema,
    "restrictions",
  );
  return body.restrictions;
}

// A lift right after an issue on the other node can 404 here until it
// replicates (§5): asking the other node is safe because lift is idempotent.
function liftRetryOn(err: AvServContractError): boolean {
  return retryableOnOtherNode(err) || (err.status === 404 && err.code === "restriction_not_found");
}

/** POST …/restrictions/{id}/lift (§4). Idempotent: lifting a lifted restriction
 *  returns the row with the first lift's note and actor. */
export async function liftRestriction(
  accountId: string,
  restrictionId: string,
  input: LiftInput,
): Promise<Restriction> {
  const primary = contractBaseUrl(PURPOSE);
  if (isMock(primary)) return mock.liftRestriction(accountId, restrictionId, input);

  return callWithFailover(
    primary,
    `${restrictionsPath(accountId)}/${encodeURIComponent(restrictionId)}/lift`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    RestrictionSchema,
    "lift",
    liftRetryOn,
  );
}
