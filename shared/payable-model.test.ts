import { describe, expect, it } from "vitest";
import { equivalentOfferedModel } from "./payable-model";

describe("equivalentOfferedModel (#1154)", () => {
  it("keeps nothing to replace when the pick is offered", () => {
    expect(equivalentOfferedModel("grok-4.7", ["grok-4.7", "grok-4.6"])).toBeNull();
  });

  it("takes the nearest version of the same line", () => {
    expect(equivalentOfferedModel("grok-4.7", ["grok-4.5", "grok-4.6", "grok-4.6-fast"])).toBe("grok-4.6");
  });

  it("prefers the newer version on a tie and a newer one when the pick is older", () => {
    expect(equivalentOfferedModel("grok-4.5", ["grok-4.6", "grok-4.4"])).toBe("grok-4.6");
    expect(equivalentOfferedModel("grok-4.5", ["grok-4.7", "grok-4.6"])).toBe("grok-4.6");
  });

  it("keeps a fast pick on a fast model when the line itself is not offered", () => {
    expect(equivalentOfferedModel("grok-4.7-build-fast", ["grok-4.6", "grok-4.6-fast"])).toBe("grok-4.6-fast");
  });

  it("falls back to the nearest model of any kind", () => {
    expect(equivalentOfferedModel("grok-4.7-build-fast", ["grok-4.6", "grok-4.5"])).toBe("grok-4.6");
  });

  it("answers null when the session offers nothing", () => {
    expect(equivalentOfferedModel("grok-4.7", [])).toBeNull();
  });
});
