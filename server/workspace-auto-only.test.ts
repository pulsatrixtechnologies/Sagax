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

    expect(store.retireFixedWorkspaces()).toEqual({ bots: 2, pins: 3 });

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
    expect(reloaded.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
  });

  it("drops a stray pin origin without a place", () => {
    const store = new Store(newBotDefault);
    const bot = store.createBot({}, { seedMessages: false });
    store.patchTask(bot.id, bot.threadId, { surfaceSource: "user" });
    expect(store.retireFixedWorkspaces()).toEqual({ bots: 0, pins: 0 });
    expect(new Store(newBotDefault).taskByThread(bot.id, bot.threadId)?.surfaceSource).toBeUndefined();
  });

  it("keeps every level, Always allow list and grant a person set: the 2026-10-18 move to Ask is not replayed (#1098)", () => {
    const store = new Store(newBotDefault);
    const browser = store.createBot({}, { seedMessages: false });
    store.patchBot(browser.id, { computer: "browser", approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash"] });
    const thread = store.createTask(browser.id, "Its own level", false)!;
    store.patchTask(browser.id, thread.threadId, { approvalMode: "full" });
    const pinned = store.createTask(browser.id, "Pinned to a VM", false)!;
    store.patchTask(browser.id, pinned.threadId, { surface: "vm", surfaceSource: "user", approvalMode: "auto" });

    expect(store.retireFixedWorkspaces()).toEqual({ bots: 1, pins: 1 });

    const reloaded = new Store(newBotDefault);
    expect(reloaded.bot(browser.id)).toMatchObject({ approvalMode: "auto", autoApprove: true, alwaysAllow: ["Bash"] });
    expect(reloaded.bot(browser.id)?.computer).toBeUndefined();
    expect(reloaded.taskByThread(browser.id, thread.threadId)?.approvalMode).toBe("full");
    expect(reloaded.taskByThread(browser.id, pinned.threadId)).toMatchObject({ approvalMode: "auto" });
    expect(reloaded.taskByThread(browser.id, pinned.threadId)?.surface).toBeUndefined();
  });
});
