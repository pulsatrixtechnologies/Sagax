import { describe, expect, it } from "vitest";

import { parseBotProfilePatch } from "./bot-profile.ts";
import { finishUntilPrompt, remindAfterCompaction } from "./finish-until.ts";

describe("do not finish until", () => {
  it("stays off until the person sets one sentence on their bot", () => {
    expect(finishUntilPrompt("")).toBe("");
    expect(finishUntilPrompt(undefined)).toBe("");
    expect(parseBotProfilePatch({ finishUntil: "the tests pass" })).toEqual({ ok: true, patch: { finishUntil: "the tests pass" } });
    expect(parseBotProfilePatch({ finishUntil: "" })).toEqual({ ok: true, patch: { finishUntil: undefined } });
    expect(parseBotProfilePatch({ finishUntil: "one\ntwo" }).ok).toBe(false);
  });

  it("says the condition in the prompt and again after a compaction", () => {
    const prompt = finishUntilPrompt("the tests pass");
    expect(prompt.startsWith("Do not finish until: the tests pass")).toBe(true);
    expect(prompt).toContain("not a task list");
    const summary = remindAfterCompaction("Older turns were folded.", "the tests pass");
    expect(summary).toContain("Older turns were folded.");
    expect(summary).toContain("Do not finish until: the tests pass");
    expect(remindAfterCompaction(summary, "the tests pass")).toBe(summary);
    expect(remindAfterCompaction("Older turns were folded.", "")).toBe("Older turns were folded.");
  });
});
