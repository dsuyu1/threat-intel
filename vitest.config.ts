import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/agents/vitest.config.ts", "apps/web/vitest.config.ts", "packages/db/vitest.config.ts"],
  },
});
