import { describe, expect, it } from "vitest";

import { cleanDisabledModels, modelKey, modelOffer, offeredModels, parseModelKey } from "./offered-models.ts";

const engine = (instanceId: string, ids: string[], def = ids[0] ?? "") => ({ instanceId, models: { default: def, options: ids.map((id) => ({ id })) } });
const solo = { organization: false, allowedEngines: null };

describe("model switches", () => {
  it("names a model <engine>/<model>, a slash in the model kept", () => {
    expect(modelKey("openrouter", "vendor/model")).toBe("openrouter/vendor/model");
    expect(parseModelKey("openrouter/vendor/model")).toEqual({ instanceId: "openrouter", model: "vendor/model" });
    expect(parseModelKey("nothing")).toBeNull();
    expect(cleanDisabledModels(["a/b", "a/b", "bad", 3, " c/d "])).toEqual(["a/b", "c/d"]);
  });

  it("says who turned a model off: the organization first, then the person", () => {
    const switches = { org: ["claude/opus"], mine: ["claude/opus", "claude/haiku"] };
    expect(modelOffer(switches, "claude", "opus")).toBe("adminOff");
    expect(modelOffer(switches, "claude", "haiku")).toBe("personOff");
    expect(modelOffer(switches, "claude", "sonnet")).toBe("on");
    expect(modelOffer(null, "claude", "sonnet")).toBe("on");
  });

  it("drops the models off from every list, moves the default, and drops an engine with none left", () => {
    const instances = [engine("claude", ["opus", "sonnet"], "opus"), engine("grok", ["fast"]), engine("pending", [])];
    const out = offeredModels(instances, solo, { org: ["claude/opus"], mine: ["grok/fast"] });
    expect(out.map((row) => row.instanceId)).toEqual(["claude", "pending"]);
    expect(out[0]?.models).toEqual({ default: "sonnet", options: [{ id: "sonnet" }] });
    // Settings keeps every model, to switch them
    expect(offeredModels(instances, solo, { org: ["claude/opus"] }, "settings")).toHaveLength(3);
    // nothing off: the same rows
    expect(offeredModels(instances, solo, null)).toEqual(instances);
  });

  it("applies the organization's engine list first", () => {
    const instances = [engine("claude", ["opus"]), engine("grok", ["fast"])];
    expect(offeredModels(instances, { organization: true, allowedEngines: ["grok"] }, null).map((row) => row.instanceId)).toEqual(["grok"]);
  });
});
