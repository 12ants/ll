import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Nested development worktrees have their own independent test suites.
    include: ["tests/**/*.test.ts"],
  },
});
