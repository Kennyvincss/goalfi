import { describe, expect, it } from "vitest";
import { resolveAppUrl } from "./app-url";

describe("resolveAppUrl", () => {
  it("keeps a correct https URL", () => expect(resolveAppUrl({ GOALFI_APP_URL: "https://goalfi.vercel.app" })).toMatchObject({ url: "https://goalfi.vercel.app", problem: null }));
  it("adds a missing https://", () => expect(resolveAppUrl({ GOALFI_APP_URL: "goalfi.vercel.app" })).toMatchObject({ url: "https://goalfi.vercel.app", source: "GOALFI_APP_URL (fixed)" }));
  it("drops trailing slash and paths", () => expect(resolveAppUrl({ GOALFI_APP_URL: " https://goalfi.vercel.app/dashboard/ " }).url).toBe("https://goalfi.vercel.app"));
  it("falls back to Vercel's production domain", () => expect(resolveAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "goalfi-abc.vercel.app" })).toMatchObject({ url: "https://goalfi-abc.vercel.app", source: "VERCEL_PROJECT_PRODUCTION_URL" }));
  it("falls back to localhost with a problem when nothing is set", () => expect(resolveAppUrl({})).toMatchObject({ url: "http://localhost:3000", problem: "GOALFI_APP_URL is not set" }));
  it("reports garbage values", () => expect(resolveAppUrl({ GOALFI_APP_URL: "http://" }).problem).toMatch(/not a valid address/));
});
