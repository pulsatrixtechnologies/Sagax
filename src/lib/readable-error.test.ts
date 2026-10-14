import { describe, expect, it } from "vitest";

import { readableErrorMessage } from "./readable-error";

describe("readableErrorMessage", () => {
  it("keeps a sentence", () => {
    expect(readableErrorMessage(new Error("The token was refused."), "fallback")).toBe("The token was refused.");
  });

  // 2026-10-14: Settings showed a raw zod issue list for providers.codex.
  it("never shows a schema issue list", () => {
    const zod = '[{"expected":"object","code":"invalid_type","path":["providers","codex"],"message":"Invalid input: expected object, received undefined"}]';
    expect(readableErrorMessage(new Error(zod), "Could not load.")).toBe("Could not load.");
    expect(readableErrorMessage(new Error('{"error":"x"}'), "Could not load.")).toBe("Could not load.");
  });

  it("falls back for empty, stack-like or huge messages", () => {
    expect(readableErrorMessage(new Error(""), "f")).toBe("f");
    expect(readableErrorMessage(undefined, "f")).toBe("f");
    expect(readableErrorMessage(new Error("Boom\n    at x (y.ts:1:1)"), "f")).toBe("f");
    expect(readableErrorMessage(new Error("a".repeat(400)), "f")).toBe("f");
  });
});
