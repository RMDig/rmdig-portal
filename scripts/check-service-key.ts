import { checkDeviceAdminKeyConfig, checkServiceKeyConfig } from "../lib/avserv/service-key";
import { checkSarPayloadKeyConfig } from "../lib/sar/payload-seal";

// Runs before `next build` on Vercel (package.json "vercel-build"). When the
// build talks to a real AvServ, the service-JWT key must load as Ed25519 and
// match the fingerprint AvServ holds for the kid, or the build fails: Vercel
// keeps serving the last good deployment instead of one whose every signed
// call would fail. Mock AvServ (previews, local) skips. Reads process.env
// directly, like migrate-preview: lib/env would validate unrelated variables.
const result = checkServiceKeyConfig({
  AVSERV_BASE_URL: process.env.AVSERV_BASE_URL,
  AVSERV_SERVICE_JWT_SIGNING_KEY_B64: process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64,
  AVSERV_SERVICE_JWT_KID: process.env.AVSERV_SERVICE_JWT_KID,
  AVSERV_SERVICE_JWT_KEY_SHA256: process.env.AVSERV_SERVICE_JWT_KEY_SHA256,
});
if (result.status === "error") {
  console.error(`check-service-key: ${result.error}`);
  process.exit(1);
}
console.log(
  result.status === "skipped"
    ? "check-service-key: mock or no AvServ, skipping."
    : `check-service-key: ${result.kid} loads and matches (sha256 ${result.fingerprint}).`,
);

// The device-admin key (plan 36 S3) is optional until AvServ installs its kid:
// absent is fine, but present and wrong fails the build like the everyday key.
const admin = checkDeviceAdminKeyConfig({
  AVSERV_BASE_URL: process.env.AVSERV_BASE_URL,
  AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64: process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64,
  AVSERV_DEVICE_ADMIN_JWT_KID: process.env.AVSERV_DEVICE_ADMIN_JWT_KID,
  AVSERV_DEVICE_ADMIN_JWT_KEY_SHA256: process.env.AVSERV_DEVICE_ADMIN_JWT_KEY_SHA256,
});
if (admin.status === "error") {
  console.error(`check-service-key: ${admin.error}`);
  process.exit(1);
}
console.log(
  admin.status === "ok"
    ? `check-service-key: ${admin.kid} (device admin) loads and matches (sha256 ${admin.fingerprint}).`
    : `check-service-key: device-admin key ${admin.status === "absent" ? "not set; signing phones out stays unavailable" : "skipped"}.`,
);

// The SAR payload keys (plan 36 H4): with intake configured, intake refuses
// every alert (503) without them, so a build that has intake keys but no
// usable payload key fails here instead of going live.
const sarPayload = checkSarPayloadKeyConfig({
  AVSERV_SAR_INTAKE_KEYS: process.env.AVSERV_SAR_INTAKE_KEYS,
  SAR_PAYLOAD_KEYS: process.env.SAR_PAYLOAD_KEYS,
});
if (sarPayload.status === "error") {
  console.error(`check-service-key: ${sarPayload.error}`);
  process.exit(1);
}
console.log(
  sarPayload.status === "ok"
    ? `check-service-key: SAR payload key ${sarPayload.current} loads.`
    : "check-service-key: SAR intake not configured, skipping its payload key.",
);
