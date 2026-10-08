import { describe, expect, it } from "vitest";

import { classifyGrokError, describeGrokAccountError } from "./grok.ts";

describe("Grok Build account refusals", () => {
  it("reads xAI's 402 inside a JSON-RPC internal error as no credit left (GOX, grok 1.0.50, 2026-10-08)", () => {
    const recorded = {
      code: -32603,
      message: "Internal error",
      data: { message: "API error (status 402 Payment Required): Grok Build usage balance exhausted", http_status: 402 },
    };
    expect(classifyGrokError(recorded)).toBe("insufficient_funds");
    // the same words without the status field
    expect(classifyGrokError({ code: -32603, message: "Internal error", data: { message: "Grok Build usage balance exhausted" } })).toBe("insufficient_funds");
  });

  it("tells the other account refusals apart and leaves the rest to the generic path", () => {
    expect(classifyGrokError({ code: -32603, message: "Internal error", data: { message: "API error (status 401 Unauthorized)", http_status: 401 } })).toBe("invalid_credentials");
    expect(classifyGrokError({ code: -32603, message: "Internal error", data: { message: "monthly usage limit reached" } })).toBe("quota_or_region_restriction");
    expect(classifyGrokError({ code: -32602, message: "Invalid params" })).toBeUndefined();
    expect(classifyGrokError(new Error("socket hang up"))).toBeUndefined();
    expect(classifyGrokError(null)).toBeUndefined();
  });

  it("says what refused and what to do", () => {
    const text = describeGrokAccountError("insufficient_funds", "grok-4.5");
    expect(text).toBe("Grok refused this turn (model grok-4.5): the usage balance of the Grok account it runs on is used up (xAI answered 402 Payment Required). Add credit to that Grok account at grok.com, or choose another model for this bot.");
    expect(describeGrokAccountError("invalid_credentials")).toMatch(/^Grok refused this turn: .*Sign in to Grok again/);
  });
});
