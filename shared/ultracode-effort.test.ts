import { describe, expect, it } from "vitest";
import {
  ULTRACODE_EFFORT,
  effortAcceptedByEngine,
  isUltracodeEffort,
  maxNativeEffort,
  pickerEffortLevels,
  resolveEngineTurnEffort,
} from "./ultracode-effort.ts";

describe("ultracode effort", () => {
  const codex = ["low", "medium", "high", "xhigh", "max"] as const;

  it("adds ultracode to picker levels when the engine offers effort", () => {
    expect(pickerEffortLevels(codex)).toEqual([...codex, ULTRACODE_EFFORT]);
    expect(pickerEffortLevels([])).toEqual([]);
  });

  it("accepts ultracode when any native level is offered", () => {
    expect(effortAcceptedByEngine(ULTRACODE_EFFORT, codex)).toBe(true);
    expect(effortAcceptedByEngine(ULTRACODE_EFFORT, [])).toBe(false);
    expect(effortAcceptedByEngine("high", codex)).toBe(true);
  });

  it("maps ultracode to the CLI on Claude and to max elsewhere", () => {
    expect(resolveEngineTurnEffort(ULTRACODE_EFFORT, "claudeAgent", codex)).toBe(ULTRACODE_EFFORT);
    expect(resolveEngineTurnEffort(ULTRACODE_EFFORT, "codex", codex)).toBe("max");
    expect(resolveEngineTurnEffort("high", "codex", codex)).toBe("high");
    expect(isUltracodeEffort(ULTRACODE_EFFORT)).toBe(true);
    expect(maxNativeEffort(["low", "high", "xhigh"])).toBe("xhigh");
  });
});
