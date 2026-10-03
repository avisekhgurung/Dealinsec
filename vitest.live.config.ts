import { defineConfig } from "vitest/config";
import path from "path";

// Live evaluations (real model calls). Deliberately separate from vitest.config.ts:
// `vitest run` never picks these up, so CI stays free and deterministic. Run them
// through script/agent-eval.mts.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "shared") } },
  test: {
    include: ["server/**/*.eval.ts"],
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ["dot"],
  },
});
