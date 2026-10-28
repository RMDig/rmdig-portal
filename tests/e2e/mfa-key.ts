// The TOTP encryption key the e2e server runs with (playwright.config.ts) and
// global-setup seals MFA_ADMIN_USER's secret under. Test-only, never real. Its
// own module so the Playwright config doesn't import the test helpers.
export const E2E_MFA_ENCRYPTION_KEYS = "e2e:67193f454e24552582f7c31c8247e3d9e78c8830f75a1c8ce2dfff8f8bd64c07";
