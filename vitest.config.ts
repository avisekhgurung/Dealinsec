import { defineConfig } from "vitest/config";
import path from "path";

// Pure-logic tests only (no database, no network): the modules under test must
// not import server/storage or server/db.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "shared") } },
  test: { include: ["server/**/*.test.ts", "shared/**/*.test.ts"] },
});
