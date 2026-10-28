import { describe, expect, it } from "vitest";

import type { ModelSelection } from "./contracts.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });

describe("conversation turn timing", () => {
  it("keeps the numbers on the conversation across a restart, not in a message", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Helper" }, { seedMessages: false });
    const threadId = bot.threadId;
    store.noteConversationTiming(threadId, { queueMs: 40 });
    store.noteConversationTiming(threadId, { firstResponseMs: 160 });
    const task = store.taskByThread(bot.id, threadId);
    expect(task?.turnTiming).toEqual({ queueMs: 40, firstResponseMs: 160 });
    expect(store.messagesFor(threadId).some((message) => JSON.stringify(message).includes("queueMs"))).toBe(false);
    const reloaded = new Store(selection);
    expect(reloaded.taskByThread(bot.id, threadId)?.turnTiming).toEqual({ queueMs: 40, firstResponseMs: 160 });
  });
});
