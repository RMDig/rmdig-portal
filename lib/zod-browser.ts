import { config } from "zod";

// Zod compiles object schemas with `new Function` when it can, and finds out
// by trying `Function("")` once. Under the CSP (lib/csp.ts, no 'unsafe-eval')
// that probe is a violation: Report-Only sent it to Sentry as "Blocked
// 'script' from 'eval:'" (2026-10-20), and enforced it would throw and be
// caught. jitless is Zod's switch for CSP pages: no probe, no eval, same
// results. Browser only (instrumentation-client.ts); the server has no CSP and
// keeps the faster compiled path.
config({ jitless: true });
