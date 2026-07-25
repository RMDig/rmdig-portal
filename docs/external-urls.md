# External URL Registrations

Where the portal's public URLs are (or should be) registered externally, so a
route change never silently breaks a store listing or carrier registration.
**These paths are load-bearing once registered — do not rename a route below
without updating every registration in its row** (and CLAUDE.md §3.7 keeps
them public/no-auth).

Canonical host for registrations: `https://app.rmdig.ai`. The rmdig.ai DNS
cutover is **complete (2026-07-25)** — the same pages also answer on
`https://rmdig.ai` and `https://www.rmdig.ai` — but registrations made
against `app.` stay valid regardless, so prefer `app.` for anything hard to
edit later. Auth flows and emailed links stay on `app.` (`NEXTAUTH_URL`);
switching them to the apex is optional and requires adding the apex callback
to the Google OAuth client first.

## The registry

**Status (2026-07-25):** every URL below is live, public, and carries its
required content (including the A2P SMS disclosures on `/privacy`) — the
portal side is filing-ready. The registrations themselves are operator
actions still to be entered in each console.

| Consumer | Field | URL |
|---|---|---|
| Apple App Store Connect | Privacy Policy URL (App Information) | `https://app.rmdig.ai/privacy` |
| Apple App Store Connect | Support URL | `https://app.rmdig.ai/support` |
| Apple App Store Connect | Marketing URL (optional) | `https://app.rmdig.ai/` |
| Google Play Console | Store listing → Privacy policy | `https://app.rmdig.ai/privacy` |
| Google Play Console | Account deletion URL | `https://app.rmdig.ai/account/delete` |
| Google Play Console | Support email / website | `support@rmdig.ai` / `https://app.rmdig.ai/support` |
| Twilio A2P 10DLC (campaign vetting) | Business website | `https://rmdig.ai/` (live; brand ↔ domain match) |
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

## A2P SMS disclosures — DONE (2026-07-25)

`/privacy` carries a "Text messages (SMS)" section with the disclosures
carrier vetting (CTIA guidelines) expects: the consent model (the **user**
supplies their **emergency contact's** number; the contact is the SMS
recipient, alerts dispatched by AvServ via Twilio), message types +
event-driven frequency, "Message and data rates may apply," STOP/HELP
instructions with the honest safety consequence of opting out, and the
"No mobile information will be shared with third parties or affiliates for
marketing or promotional purposes" line reviewers scan for.

Remaining AvServ-side follow-up (not portal): surface a contact's STOP
opt-out back to the AvApp user so they can pick a different contact.
