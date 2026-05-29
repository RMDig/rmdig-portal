import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit tests only for now — pure logic with no DB or network. Integration tests
// that need a real Neon branch come later (P1.5+).
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/unit/**/*.test.ts"],
    coverage: { reporter: ["text", "lcov"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
