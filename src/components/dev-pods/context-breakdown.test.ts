import { describe, expect, it } from "vitest";
import { contextBreakdown } from "./context-breakdown";

describe("context breakdown in tokens", () => {
  it("turns measured bytes into tokens, counts memory and skills once, and names the rest", () => {
    const parts = contextBreakdown({ messages: 42, messageBytes: 200_000, tools: 112_800, memory: 20_000, skills: 30_000, agents: 9_600, prompt: 84_000 }, 130_000);
    const byKey = Object.fromEntries(parts.map((part) => [part.key, part.tokens]));
    expect(byKey).toEqual({ messages: 50_000, tools: 28_200, prompt: 8_500, skills: 7_500, memory: 5_000, agents: 2_400, engine: 28_400 });
    expect(parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(130_000);
    expect(parts[0]).toMatchObject({ key: "messages", percent: 38 });
    // never the message count as a size
    expect(parts.some((part) => part.tokens === 42)).toBe(false);
  });

  it("scales the estimate down when it overshoots the model's reading", () => {
    const parts = contextBreakdown({ prompt: 40_000, tools: 40_000 }, 10_000);
    expect(parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(10_000);
    expect(parts.find((part) => part.key === "engine")).toBeUndefined();
  });

  it("splits the measured parts alone when the model reported no total", () => {
    const parts = contextBreakdown({ prompt: 4_000, tools: 4_000 }, undefined);
    expect(parts.map((part) => part.percent)).toEqual([50, 50]);
  });

  it("is empty with nothing measured", () => {
    expect(contextBreakdown(undefined, 1000)).toEqual([]);
    expect(contextBreakdown({ messages: 3 }, undefined)).toEqual([]);
  });
});
