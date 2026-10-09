// Emoji reactions in the message store (shared/reactions.ts): a change is a
// persisted message patch, survives a reload from SQLite, and an older
// `{ emoji, by }` list is rewritten on its first change.
import { mkdirSync, rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { Store, type StoreChange } from "./store.ts";
import type { ModelSelection } from "./contracts.ts";
import type { ReactionActor } from "../shared/reactions.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const ZACH: ReactionActor = { id: "pr_zach", kind: "person", name: "Zachary Sellam" };
const CRYPTIC: ReactionActor = { id: "bot:cryptic", kind: "bot", name: "Cryptic" };

describe("Store.reactToMessage", () => {
  beforeEach(() => {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
  });

  it("patches the message, emits message.patch only on a change, and persists", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Cryptic" });
    const line = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "shipped" });
    const changes: StoreChange[] = [];
    store.onChange((change) => changes.push(change));

    const added = store.reactToMessage(bot.threadId, line.id, "🎉", ZACH, { now: 100 });
    expect(added).toMatchObject({ changed: true, added: true });
    expect(added!.message.reactions).toEqual([{ emoji: "🎉", actors: [ZACH], at: 100 }]);
    expect(store.reactToMessage(bot.threadId, line.id, "🎉", ZACH, { mode: "add" })!.changed).toBe(false);
    store.reactToMessage(bot.threadId, line.id, "🎉", CRYPTIC, { mode: "add", now: 200 });
    expect(changes.map((change) => change.type)).toEqual(["message.patch", "message.patch"]);
    expect(store.reactToMessage(bot.threadId, "missing", "🎉", ZACH)).toBeNull();

    // a fresh process reads it back from SQLite
    closeMessageDb();
    const reloaded = new Store(selection);
    expect(reloaded.messagesFor(bot.threadId).find((m) => m.id === line.id)!.reactions)
      .toEqual([{ emoji: "🎉", actors: [ZACH, CRYPTIC], at: 100 }]);
    // the last one out removes the field
    reloaded.reactToMessage(bot.threadId, line.id, "🎉", ZACH);
    reloaded.reactToMessage(bot.threadId, line.id, "🎉", CRYPTIC);
    expect(reloaded.messagesFor(bot.threadId).find((m) => m.id === line.id)!.reactions).toBeUndefined();
  });

  it("rewrites a legacy list on its first change", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Cryptic" });
    const line = store.appendMessage(bot.threadId, { role: "user", kind: "text", text: "old" });
    store.patchMessage(bot.threadId, line.id, { reactions: [{ emoji: "👍", by: "user" }] as never });
    const result = store.reactToMessage(bot.threadId, line.id, "👍", ZACH, { legacyUser: ZACH });
    // the legacy "user" was Zach: his press takes it back
    expect(result).toMatchObject({ changed: true, added: false });
    expect(result!.message.reactions).toBeUndefined();
  });
});
