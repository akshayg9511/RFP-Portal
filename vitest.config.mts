import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Mirrors the `@/*` alias from tsconfig.json. Without it a test importing a
 * module that itself imports `@/lib/...` fails to resolve, which is how the
 * cost-chain tests first broke.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
