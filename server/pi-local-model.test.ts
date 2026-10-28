import { describe, expect, it } from "vitest";

import { isPiLocalModel } from "./pi-local-model.ts";

describe("isPiLocalModel (#1422)", () => {
  it("is a pi model on a local host", () => {
    expect(isPiLocalModel("piAgent", "omlx/Some-Model-35B")).toBe(true);
    expect(isPiLocalModel("piAgent", "ollama/llama3")).toBe(true);
    expect(isPiLocalModel("piAgent", "lmstudio/qwen")).toBe(true);
  });

  it("is never a cloud model, another engine or a bare name", () => {
    expect(isPiLocalModel("piAgent", "anthropic/claude-sonnet-5")).toBe(false);
    expect(isPiLocalModel("piAgent", "openai/gpt-5")).toBe(false);
    expect(isPiLocalModel("claudeAgent", "omlx/Some-Model-35B")).toBe(false);
    expect(isPiLocalModel("piAgent", "Some-Model-35B")).toBe(false);
    expect(isPiLocalModel("piAgent", "/omlx")).toBe(false);
    expect(isPiLocalModel(undefined, "omlx/x")).toBe(false);
    expect(isPiLocalModel("piAgent", null)).toBe(false);
  });
});
