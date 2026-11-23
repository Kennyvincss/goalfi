import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@goalfi/bot", () => ({}));
vi.mock("./services", () => ({ services: () => ({}) }));
const { secretProblem } = await import("./telegram");

describe("secretProblem", () => {
  it("accepts a good secret, even with stray whitespace", () => expect(secretProblem("S", "  abcDEF123_-abcdef123 \n")).toBeNull());
  it("explains a missing value", () => expect(secretProblem("S", undefined)).toMatch(/not set/));
  it("names disallowed characters", () => expect(secretProblem("S", "abc!def@ghi jklmnopq")).toMatch(/“!” “@” space/));
  it("reports length", () => expect(secretProblem("S", "abc123")).toMatch(/only 6 characters/));
});
