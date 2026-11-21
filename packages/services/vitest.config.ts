import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: { deps: { inline: ["@pm-amm/sdk"] } },
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
