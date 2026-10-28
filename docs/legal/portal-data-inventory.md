# Portal data inventory: cookies and retention

Facts for counsel's Privacy Policy (v10.26.26 review, 2026-10-27): what the
rmdig portal (rmdig.ai) sets in a browser and what its database keeps, for how
long. AvServ's data (check-outs, alerts, contacts, device reports, incidents,
agreement acceptances) is AvServ's to list. These are facts about the code, not
policy wording. Update this file when a cookie, table or purge job changes.

## Cookies

The portal sets only the cookies it needs to sign people in and keep the site
secure. No analytics, advertising, pixel or tracking cookies, and no
`localStorage` or `sessionStorage`.

| Cookie | Set by | Purpose | Lifetime |
| --- | --- | --- | --- |
| `__Secure-authjs.session-token` | Auth.js | Keeps you signed in. Holds a random token; the session row it points at is in the portal DB (stored hashed). | 30 days, or until sign-out |
| `__Host-authjs.csrf-token` | Auth.js | Protects sign-in and sign-out forms against cross-site request forgery. | Browser session |
| `__Secure-authjs.callback-url` | Auth.js | Where to return after signing in. | Browser session |
| `__Secure-authjs.pkce.code_verifier` | Auth.js | Google sign-in only: secures the round trip to Google. | 15 minutes, cleared after sign-in |
| `rmdig_webauthn` | Portal ([lib/auth/webauthn-challenge.ts](../../lib/auth/webauthn-challenge.ts)) | One passkey challenge, signed and `httpOnly`. | 5 minutes, cleared when used |

Over plain HTTP in development the Auth.js names drop the `__Secure-`/`__Host-`
prefix. Sentry runs in the browser for error reporting with
`sendDefaultPii: false` and sets no cookies.

## What the portal database keeps, and for how long

Two daily jobs delete data on a schedule: SAR alert retention
([lib/sar/retention.ts](../../lib/sar/retention.ts)) and the cleanup of rows
past use ([lib/retention/expired-rows.ts](../../lib/retention/expired-rows.ts)).
Everything else is kept while the account or organisation exists and is
removed by the CPA deletion process ([runbook](../runbook.md) "Data-deletion requests", 45
days from confirmation). Deleting a user row cascades to their sessions,
sign-in accounts, MFA rows, passkeys, memberships, tokens and security events.

| Data | What it holds | Kept |
| --- | --- | --- |
| Users | Email, name and display name, Google profile image (Google sign-in), salted password hash, encrypted TOTP secret, security-notice preference, linked AvAI account id | Until account deletion |
| Sign-in accounts | Google account link (provider ids and tokens) | Until account deletion |
| Passkeys, MFA recovery codes | Public key and metadata; recovery codes hashed | Until removed by the user, or account deletion |
| Sessions | Hashed token, created / last-seen / last-auth times, how the user signed in, browser user-agent string. No IP address. | Deleted at sign-out, or within a day of expiring (30 days without use) |
| Account security events | What changed and when: password, MFA, recovery codes, passkeys, sessions signed out, security-notice setting, App Lock reset code issued (never the code) | Until account deletion |
| Password-reset, email-verification, deletion-confirmation tokens | Hashed token, email, expiry | Valid 60 minutes / 24 hours / 24 hours; deleted 7 days after expiry. A deletion request someone confirmed is kept (next row). |
| Rate-limit counters | Hashed key (email, IP or phone hashed), attempt count, window start | Reset each window (at most 24 hours); deleted 7 days after the window started |
| Deletion requests | Email, hashed token, requested / confirmed / completed times, operator's completion note | Confirmed requests: kept as the record that the request was handled. Unconfirmed: deleted 7 days after the link expires. |
| SAR organisations | Team details, contact name, email, verified phone; status history; the team's terms for its members | Kept as evidence once the team has history; never deleted (runbook "Removing a SAR org") |
| SAR memberships, staff roles | Who belongs to which team or role, history logs | Until removed; logs kept as evidence |
| Invitations (team, staff, advertiser) | Invitee email, role, hashed token, who invited them | Valid 14 days. Unaccepted: deleted 7 days after expiry. Accepted: kept as the record of who invited whom |
| SAR alerts received from AvServ | Alert, follow-ups, acknowledgements | Position and planned route removed 24 hours after the alert ends; the alert, follow-ups and acknowledgements deleted 90 days after it ends |
| SAR alert and map view logs | Which team member viewed which alert or the map, when | 365 days |
| Restriction review requests | The user's message and the operator's decision note | Until account deletion |
| Advertiser accounts, campaigns, creatives | Business details, contact, ad text, review history | Until removed; history logs kept |
| Announcements | Operator-written notices and their log | Indefinitely |

Volunteer sign-ups (`/collection_signup`) are never stored in the database;
each is an email to rmdig admins.

## Backups and service providers

- **Neon point-in-time restore:** 6 hours of history.
- **Nightly encrypted dump to Cloudflare R2:** each kept 30 days, then deleted
  by a bucket lifecycle rule. A deleted account can persist in a backup for up
  to 30 days.
- **Vercel request logs, Sentry error events, Resend email logs:** kept for
  each provider's plan retention. Not verified here. Check the account
  settings before quoting a number.
