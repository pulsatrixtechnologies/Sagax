import { describe, expect, it } from "vitest";

import { onCount, switchableModels, toggledList } from "./ModelSwitchesSettings";

describe("Settings > Models > Active models", () => {
  it("lists an engine's own models, never a model of this computer grafted on it", () => {
    expect(switchableModels({ models: { default: "a", options: [{ id: "a", label: "A" }, { id: "b", label: "" }, { id: "x", label: "X", local: true }, { id: "srv::m", label: "M" }] } })).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "b" },
    ]);
  });

  it("counts the models on and switches one in the person's list", () => {
    const models = [{ id: "opus" }, { id: "sonnet" }, { id: "haiku" }];
    expect(onCount("claude", models, { org: ["claude/opus"], mine: ["claude/haiku"] })).toBe(1);
    expect(toggledList(["claude/haiku"], "claude/sonnet", false)).toEqual(["claude/haiku", "claude/sonnet"]);
    expect(toggledList(["claude/haiku", "claude/sonnet"], "claude/haiku", true)).toEqual(["claude/sonnet"]);
  });
});
