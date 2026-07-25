# External URL Registrations

Where the portal's public URLs are (or should be) registered externally, so a
route change never silently breaks a store listing or carrier registration.
**These paths are load-bearing once registered — do not rename a route below
without updating every registration in its row** (and CLAUDE.md §3.7 keeps
them public/no-auth).

Canonical host: `https://app.rmdig.ai`. After the rmdig.ai DNS cutover the
same pages also answer on `https://rmdig.ai`; registrations made against
`app.` stay valid regardless, so prefer `app.` for anything hard to edit
later.

## The registry

| Consumer | Field | URL |
|---|---|---|
| Apple App Store Connect | Privacy Policy URL (App Information) | `https://app.rmdig.ai/privacy` |
| Apple App Store Connect | Support URL | `https://app.rmdig.ai/support` |
| Apple App Store Connect | Marketing URL (optional) | `https://app.rmdig.ai/` |
| Google Play Console | Store listing → Privacy policy | `https://app.rmdig.ai/privacy` |
| Google Play Console | Account deletion URL | `https://app.rmdig.ai/account/delete` |
| Google Play Console | Support email / website | `support@rmdig.ai` / `https://app.rmdig.ai/support` |
| Twilio A2P 10DLC (campaign vetting) | Business website | `https://app.rmdig.ai/` (→ `https://rmdig.ai` post-cutover) |
| Twilio A2P 10DLC | Privacy policy / Terms | `https://app.rmdig.ai/privacy` / `https://app.rmdig.ai/terms` |
| AvApp `lib/copy/compliance_copy.dart` | `kPrivacyPolicyUrl` | `https://app.rmdig.ai/privacy` |
| AvApp `lib/copy/compliance_copy.dart` | `kTermsOfServiceUrl` | `https://app.rmdig.ai/terms` |
| AvApp Settings rows | support / delete account | `https://app.rmdig.ai/support` / `https://app.rmdig.ai/account/delete` |

## Consistency obligations

- `/privacy` must mirror AvApp `ios/Runner/PrivacyInfo.xcprivacy` **and** the
  Play Data Safety form (CLAUDE.md §0) — a data-practice change touches all
  three in the same release.
- The Play **account deletion URL** must remain exercisable end-to-end with
  no login (it is — the flow is email-confirmed, CPA 45-day).
- Trademark: public pages carry **AvAI™** (footer attribution + first
  prominent mention per page). Swap ™ → ® only when the USPTO registration
  formally issues.

## Open item — A2P SMS disclosures (blocking the Twilio campaign)

Carrier vetting (CTIA guidelines) expects the privacy policy to carry
SMS-specific disclosures, which `/privacy` does not yet have:

- How phone numbers are collected/consented — note the unusual model here:
  the **user** supplies their **emergency contact's** number, and the contact
  is the SMS recipient (safety alerts + all-clears, dispatched by AvServ via
  Twilio).
- Message types + expected frequency; "Message and data rates may apply."
- STOP / HELP opt-out instructions — including the honest safety consequence:
  a contact who texts STOP stops receiving safety alerts. (Surfacing a
  contact's opt-out back to the AvApp user is an AvServ-side follow-up.)
- The line reviewers scan for near-verbatim: "No mobile information will be
  shared with third parties or affiliates for marketing or promotional
  purposes."

Add this section to `/privacy` before filing the A2P campaign registration.
