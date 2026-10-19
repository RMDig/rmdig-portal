import { checkDeviceAdminKeyConfig, checkServiceKeyConfig } from "../lib/avserv/service-key";

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
