// Workspace is always Auto (JC 2026-10-18): nobody picks a place for a bot
// or a conversation any more; the bot picks where each task runs. These pin
// the rule (autoOnlyDestination) and the one-time, idempotent move of what
// an older build saved (Store.retireFixedWorkspaces). Off is a restriction,
// not a place, and stays.
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";
import { autoOnlyDestination } from "./surface.ts";

describe("a Works on from a request", () => {
  it("reads every place as Auto and keeps Off", () => {
    for (const place of ["cloud", "vm", "local", "browser", "auto", null, undefined, 42]) expect(autoOnlyDestination(place)).toBeUndefined();
    expect(autoOnlyDestination("off")).toBe("off");
  });
});

describe("the start sweep", () => {
  beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
  const newBotDefault = () => ({ instanceId: "claude", model: "claude-model" });

  it("moves a fixed Works on and every conversation pin back to Auto, keeps Off, and is idempotent", () => {
    const store = new Store(newBotDefault);
    const cloud = store.createBot({}, { seedMessages: false });
    const local = store.createBot({}, { seedMessages: false });
    const off = store.createBot({}, { seedMessages: false });
    const auto = store.createBot({}, { seedMessages: false });
    store.patchBot(cloud.id, { computer: "cloud", approvalMode: "ask" });
    store.patchTask(cloud.id, cloud.threadId, { approvalMode: "ask" });
    store.patchBot(local.id, { computer: "local" });
    store.patchBot(off.id, { computer: "off" });
    const second = store.createTask(auto.id, "Pinned by a person", false)!;
    store.patchTask(auto.id, second.threadId, { surface: "vm", surfaceSource: "user" });
    store.patchTask(auto.id, auto.threadId, { surface: "browser" });
    store.patchTask(off.id, off.threadId, { surface: "local", surfaceSource: "auto" });

    // the two conversations pinned to a Local VM and to the browser held the
    // Auto bot off this computer, so they ask now
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 2, pins: 3, asked: 2 });

    const reloaded = new Store(newBotDefault);
    expect(reloaded.bot(cloud.id)?.computer).toBeUndefined();
    expect(reloaded.bot(local.id)?.computer).toBeUndefined();
    // Off withholds every screen; lifting it would widen what the bot may reach.
    expect(reloaded.bot(off.id)?.computer).toBe("off");
    for (const [botId, threadId] of [[auto.id, auto.threadId], [auto.id, second.threadId], [off.id, off.threadId]] as const) {
      const task = reloaded.taskByThread(botId, threadId)!;
      expect(task.surface).toBeUndefined();
      expect(task.surfaceSource).toBeUndefined();
    }
    // Nothing left to move: no error, no write.
    expect(reloaded.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0, asked: 0 });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0, asked: 0 });
  });

  it("drops a stray pin origin without a place", () => {
    const store = new Store(newBotDefault);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchTask(bot.id, bot.threadId, { surfaceSource: "user" });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0, asked: 0 });
    expect(new Store(newBotDefault).taskByThread(bot.id, bot.threadId)?.surfaceSource).toBeUndefined();
  });

  it("puts a bot that was kept off this computer back on Ask, it and its conversations; a This computer bot keeps its level", () => {
    const store = new Store(newBotDefault);
    const browser = store.createBot({}, { seedMessages: false });
    const local = store.createBot({}, { seedMessages: false });
    const cloudAsk = store.createBot({}, { seedMessages: false });
    store.patchBot(browser.id, { computer: "browser", approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash"] });
    const thread = store.createTask(browser.id, "Its own level", false)!;
    store.patchTask(browser.id, thread.threadId, { approvalMode: "full" });
    store.patchBot(local.id, { computer: "local", approvalMode: "auto", autoApprove: true });
    store.patchBot(cloudAsk.id, { computer: "cloud", approvalMode: "ask" });
    // a conversation keeps a level of its own (here the new-bot default)
    store.patchTask(cloudAsk.id, cloudAsk.threadId, { approvalMode: "auto" });

    // the Browser bot, its two conversations, and the Cloud bot's conversation
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 3, pins: 0, asked: 4 });

    const reloaded = new Store(newBotDefault);
    expect(reloaded.bot(browser.id)).toMatchObject({ approvalMode: "ask", autoApprove: false, alwaysAllow: [] });
    expect(reloaded.bot(browser.id)?.computer).toBeUndefined();
    expect(reloaded.taskByThread(browser.id, thread.threadId)?.approvalMode).toBe("ask");
    // This computer was already in reach, under the warning it confirmed.
    expect(reloaded.bot(local.id)).toMatchObject({ approvalMode: "auto", autoApprove: true });
    expect(reloaded.bot(cloudAsk.id)?.approvalMode).toBe("ask");
    expect(reloaded.taskByThread(cloudAsk.id, cloudAsk.threadId)?.approvalMode).toBe("ask");
    expect(reloaded.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0, asked: 0 });
  });

  it("puts a conversation a pin held off this computer back on Ask, legacy levels too, and leaves an auto pin's level", () => {
    const store = new Store(newBotDefault);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchBot(bot.id, { approvalMode: "auto", autoApprove: true });
    const pinned = store.createTask(bot.id, "Pinned to the browser", false)!;
    const legacy = store.createTask(bot.id, "Legacy level", false)!;
    const following = store.createTask(bot.id, "Follows the bot", false)!;
    const autoPin = store.createTask(bot.id, "Auto pin", false)!;
    store.patchTask(bot.id, pinned.threadId, { surface: "browser", surfaceSource: "user", approvalMode: "full" });
    store.patchTask(bot.id, legacy.threadId, { surface: "vm", approvalMode: undefined, autoApprove: true });
    store.patchTask(bot.id, following.threadId, { surface: "cloud", surfaceSource: "user", approvalMode: undefined, autoApprove: undefined });
    store.patchTask(bot.id, autoPin.threadId, { surface: "cloud", surfaceSource: "auto", approvalMode: "auto" });

    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 4, asked: 3 });

    const reloaded = new Store(newBotDefault);
    for (const threadId of [pinned.threadId, legacy.threadId, following.threadId]) {
      expect(reloaded.taskByThread(bot.id, threadId), threadId).toMatchObject({ approvalMode: "ask", autoApprove: false });
    }
    expect(reloaded.taskByThread(bot.id, autoPin.threadId)?.approvalMode).toBe("auto");
    // a pin alone held those back: the bot keeps its own level
    expect(reloaded.bot(bot.id)?.approvalMode).toBe("auto");
  });
});
