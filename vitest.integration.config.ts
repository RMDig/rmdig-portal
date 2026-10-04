import path from "node:path";

import { defineConfig } from "vitest/config";

// Integration tests against a real, LOCAL PostGIS (pnpm test:integration).
// Kept out of the unit run (vitest.config.ts) so `pnpm test` stays pure. Each
// suite refuses a non-local INTEGRATION_DATABASE_URL: never point it at Neon.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
