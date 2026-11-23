import { defineConfig } from "vitest/config";

// @pm-amm/sdk's ESM build named-imports BN from the CJS @anchor-lang/core; let Vite transform it.
export default defineConfig({ test: { server: { deps: { inline: ["@pm-amm/sdk"] } } } });
