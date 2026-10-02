import { z } from "zod";


// Wire shapes for AvServ plan 23 web onboarding (contract account_agreement.md
// rev 2 §3.1, §3.3, §4), shared by the live client (agreement.ts) and the
// mock (agreement-mock.ts).

// Contract §3.1 — the account body every §4 endpoint returns. Validated so a
// drifted AvServ response fails loud instead of rendering as undefined.
export const AvaiAccountSchema = z.object({
  accountId: z.string().min(1),
  identityVersion: z.number().int(),
  legalName: z.string().nullable(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  activated: z.boolean(),
  activatedAt: z.string().nullable(),
  acceptances: z.array(
    z.object({
      acceptanceId: z.string().min(1),
      version: z.string().min(1),
      acceptedAt: z.string().min(1),
    }),
  ),
  agreement: z.object({
    currentVersion: z.string().nullable(),
    needsAcceptance: z.boolean(),
    required: z.boolean(),
  }),
});
export type AvaiAccount = z.infer<typeof AvaiAccountSchema>;

export const AcceptResultSchema = z.object({
  acceptanceId: z.string().min(1),
  version: z.string().min(1),
  activated: z.boolean(),
  activatedAt: z.string().nullable(),
});
export type AcceptResult = z.infer<typeof AcceptResultSchema>;

export interface IdentityInput {
  legalName?: string;
  displayName?: string;
}

/** The contract §3.3 body as the portal sends it (§4): identity never carries
 *  email, and client carries the browser's IP and user agent. */
export interface AcceptBody {
  version: string;
  contentHash: string;
  identity?: IdentityInput;
  assent: {
    method: "checkbox_and_button";
    textHash: string;
    presentedInFull: true;
    displayedAt?: string;
    acceptedAt?: string;
  };
  attestations: Array<{ id: string; textHash: string; value: true }>;
  client: { ip: string; userAgent: string; locale: string };
}

/** The onboarding client's name for {@link AvServContractError}: AvServ's
 *  `code`, its `detail` text, and whether the failover node answered. */
export { AvServContractError as AgreementError } from "./request";
