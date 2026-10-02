import { defineConfig } from "vitest/config";
import path from "path";

// Pure-logic tests only (no database, no network): the modules under test must
// not import server/storage or server/db. The one exception is the agent
// evaluation suite (server/agent/eval), which runs the real tools against an
// in-memory world: it replaces storage, billing, email and the model with
// vi.mock, so no real database or network is ever reached.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "shared") } },
  test: { include: ["server/**/*.test.ts", "shared/**/*.test.ts"] },
});
