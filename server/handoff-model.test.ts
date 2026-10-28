import { describe, expect, it } from "vitest";
import { fallbackWithModel, handoffModel } from "../shared/handoff-model.ts";

describe("handoff model", () => {
  it("keeps a model the engine lists and otherwise picks that engine's model", () => {
    expect(handoffModel({ instanceId: "codex", requested: "gpt-a", models: ["gpt-a", "gpt-b"], defaultModel: "gpt-b" })).toEqual({ instanceId: "codex", model: "gpt-a" });
    expect(handoffModel({ instanceId: "codex", requested: "from-another-engine", models: ["gpt-a", "gpt-b"], defaultModel: "gpt-b" })).toEqual({ instanceId: "codex", model: "gpt-b" });
    expect(handoffModel({ instanceId: "codex", models: ["gpt-a"], defaultModel: "missing" })).toEqual({ instanceId: "codex", model: "gpt-a" });
    expect(handoffModel({ instanceId: "", requested: "gpt-a", models: ["gpt-a"] })).toBeNull();
  });

  it("changes a backup only to a model of that engine", () => {
    const chain = [{ instanceId: "codex", model: "gpt-a" }];
    expect(fallbackWithModel(chain, "codex", "gpt-b", ["gpt-a", "gpt-b"])).toEqual([{ instanceId: "codex", model: "gpt-b" }]);
    expect(fallbackWithModel(chain, "codex", "other", ["gpt-a", "gpt-b"])).toBeNull();
  });
});
