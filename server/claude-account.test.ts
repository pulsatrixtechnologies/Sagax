import { describe, expect, it } from "vitest";
import { claudeAccountLinked } from "./claude-account.ts";

describe("claudeAccountLinked", () => {
  it("is own Claude login or own Anthropic key, never the organization key", () => {
    expect(claudeAccountLinked({})).toBe(false);
    expect(claudeAccountLinked({ orgKey: true })).toBe(false);
    expect(claudeAccountLinked({ signedIn: true })).toBe(true);
    expect(claudeAccountLinked({ loginMarker: true })).toBe(true);
    expect(claudeAccountLinked({ anthropicConfigured: true })).toBe(true);
    expect(claudeAccountLinked({ myKey: true })).toBe(true);
    expect(claudeAccountLinked({ signedIn: false, myKey: false, orgKey: true })).toBe(false);
  });
});
