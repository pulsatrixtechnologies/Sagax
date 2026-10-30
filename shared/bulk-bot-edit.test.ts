import { describe, expect, it } from "vitest";

import {
  applyListEdit,
  botLevelPatch,
  bulkOutcomeCounts,
  commonListItems,
  commonValue,
  grantRevertSteps,
  grantSteps,
  listEditChanges,
  mcpServersAfter,
  patchFields,
  patchForBot,
  revertPatch,
  splitBulkTargets,
  stableValueKey,
} from "./bulk-bot-edit";

describe("bulk bot edit: lists", () => {
  it("adds what a bot lacks, keeps its order", () => {
    expect(applyListEdit(["a", "b"], { mode: "add", items: ["b", "c"] })).toEqual(["a", "b", "c"]);
  });
  it("removes the items, whatever else the bot has", () => {
    expect(applyListEdit(["a", "b", "c"], { mode: "remove", items: ["b", "x"] })).toEqual(["a", "c"]);
  });
  it("replaces with exactly the items, once each", () => {
    expect(applyListEdit(["a", "b"], { mode: "replace", items: ["c", "c", "d"] })).toEqual(["c", "d"]);
    expect(applyListEdit(["a"], { mode: "replace", items: [] })).toEqual([]);
  });
  it("tells when nothing changes for a bot", () => {
    expect(listEditChanges(["a"], { mode: "add", items: ["a"] })).toBe(false);
    expect(listEditChanges(["a"], { mode: "remove", items: ["a"] })).toBe(true);
  });
  it("starts Replace from what every bot has", () => {
    expect(commonListItems([["a", "b", "c"], ["b", "c"], ["c", "b", "z"]])).toEqual(["b", "c"]);
    expect(commonListItems([])).toEqual([]);
  });
  it("starts the MCP servers from every enabled one for a bot without a list", () => {
    expect(mcpServersAfter(null, ["github", "files"], { mode: "remove", items: ["files"] })).toEqual(["github"]);
    expect(mcpServersAfter(["github"], ["github", "files"], { mode: "add", items: ["files"] })).toEqual(["github", "files"]);
  });
});

describe("bulk bot edit: mixed values", () => {
  it("shows one value when every bot has it, key order aside", () => {
    expect(commonValue([
      { botId: "a", value: { instanceId: "claude", model: "m" } },
      { botId: "b", value: { model: "m", instanceId: "claude" } },
    ])).toEqual({ mixed: false, value: { instanceId: "claude", model: "m" } });
  });
  it("reads unset and null as the same default", () => {
    expect(stableValueKey(undefined)).toBe(stableValueKey(null));
    expect(commonValue([{ botId: "a", value: undefined }, { botId: "b", value: null }]).mixed).toBe(false);
  });
  it("lists each bot's value when they differ", () => {
    const result = commonValue([{ botId: "a", value: "local" }, { botId: "b", value: "cloud" }]);
    expect(result).toEqual({ mixed: true, values: [{ botId: "a", value: "local" }, { botId: "b", value: "cloud" }] });
  });
});

describe("bulk bot edit: patches", () => {
  it("sends only the fields that differ for this bot, with its consent flags", () => {
    const bot = { computer: "cloud", approvalMode: "ask" };
    expect(patchForBot(bot, { computer: "cloud", approvalMode: "full", confirmFullAccess: true }))
      .toEqual({ approvalMode: "full", confirmFullAccess: true });
    expect(patchForBot(bot, { computer: "cloud", confirmFullAccess: true })).toEqual({});
  });
  it("leaves consent flags out of the fields and of the undo", () => {
    const patch = { approvalMode: "full", confirmFullAccess: true };
    expect(patchFields(patch)).toEqual(["approvalMode"]);
    expect(revertPatch({ approvalMode: "ask" }, patch)).toEqual({ approvalMode: "ask" });
  });
  it("puts an unset field back to not set", () => {
    expect(revertPatch({}, { computer: "local" })).toEqual({ computer: null });
  });
});

describe("bulk bot edit: Shared with", () => {
  const current = [{ target: "user:ada", level: "use" as const }, { target: "user:bob", level: "edit" as const }];
  it("adds people at their level and moves one already there", () => {
    expect(grantSteps(current, "add", [{ target: "user:ada", level: "run" }, { target: "team:ops", level: "use" }]))
      .toEqual({ put: [{ target: "user:ada", level: "run" }, { target: "team:ops", level: "use" }], remove: [] });
  });
  it("removes only those the bot has", () => {
    expect(grantSteps(current, "remove", [{ target: "user:bob", level: "use" }, { target: "user:eve", level: "use" }]))
      .toEqual({ put: [], remove: ["user:bob"] });
  });
  it("replaces: puts the list, takes the others away", () => {
    expect(grantSteps(current, "replace", [{ target: "user:ada", level: "use" }]))
      .toEqual({ put: [], remove: ["user:bob"] });
  });
  it("undoes to the grants before", () => {
    const after = [{ target: "user:ada", level: "run" as const }, { target: "team:ops", level: "use" as const }];
    expect(grantRevertSteps(current, after)).toEqual({
      put: [{ target: "user:ada", level: "use" }, { target: "user:bob", level: "edit" }],
      remove: ["team:ops"],
    });
  });
});

describe("bulk bot edit: results and targets", () => {
  it("counts a partial result", () => {
    expect(bulkOutcomeCounts([
      { botId: "a", ok: true },
      { botId: "b", ok: false, reasons: ["engine not available"] },
      { botId: "c", ok: true, skipped: true },
    ])).toEqual({ ok: 1, failed: 1, skipped: 1 });
  });
  it("splits several bot ids of one target", () => {
    expect(splitBulkTargets("atlas, iris,atlas")).toEqual(["atlas", "iris"]);
    expect(splitBulkTargets("atlas")).toBeNull();
    expect(splitBulkTargets(undefined)).toBeNull();
  });
});

// #1674: Edit N bots is the bot's own edit, as Edit bot makes it
describe("bulk bot edit: botLevelPatch", () => {
  it("names the bot's thread with a new model and drops any other thread id", () => {
    const model = { instanceId: "claude", model: "m" };
    expect(botLevelPatch({ modelSelection: model, threadId: "draft" }, "t1")).toEqual({ modelSelection: model, threadId: "t1" });
    expect(botLevelPatch({ voice: "ava", threadId: "draft" }, "t1")).toEqual({ voice: "ava" });
    expect(botLevelPatch({ modelSelection: model }, undefined)).toEqual({ modelSelection: model });
  });
});
