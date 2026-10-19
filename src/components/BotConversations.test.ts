import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bot, Message } from "@/state/store";
import { StoreProvider } from "@/state/store";
import { BotConversations, conversationLines } from "./BotConversations";

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...extra,
});
const msg = (id: string, role: "user" | "bot", text: string, kind: Message["kind"] = "text"): Message => ({ id, role, kind, text, at: 0 });

describe("BotConversations", () => {
  const row = { threadId: "work-1", otherBotId: "b", otherName: "Bravo", direction: "out" as const, updatedAt: 1 };
  it("draws nothing without a conversation", () => {
    expect(renderToStaticMarkup(createElement(StoreProvider, null, createElement(BotConversations, { bot: bot("a", "Alpha"), bots: [] })))).toBe("");
  });
  it("shows a folded Conversation with <bot> mark with the other bot's mascot, on either end", () => {
    const bots = [bot("a", "Alpha"), bot("b", "Bravo")];
    const origin = renderToStaticMarkup(createElement(StoreProvider, null, createElement(BotConversations, { bot: bot("a", "Alpha", { botConversations: [{ ...row, running: true }] }), bots })));
    expect(origin).toContain("Conversation with Bravo");
    expect(origin).toContain('aria-expanded="false"');
    expect(origin).toContain('data-bot-conversation="out"');
    expect(origin).not.toContain("work-1");
    expect(origin).toContain("data-bot-conversation-working");
    expect(origin).toContain("data-bot-conversation-stop");
    const destRow = { ...row, otherBotId: "a", otherName: "Alpha", direction: "in" as const };
    const dest = renderToStaticMarkup(createElement(StoreProvider, null, createElement(BotConversations, { bot: bot("b", "Bravo", { botConversations: [destRow] }), bots })));
    expect(dest).toContain("Conversation with Alpha");
    expect(dest).toContain('data-bot-conversation="in"');
    expect(dest).not.toContain("data-bot-conversation-stop");
  });
  it("labels the same exchange identically from both ends", () => {
    const thread = [msg("1", "user", "LIST the folder"), msg("2", "bot", "Three files"), msg("3", "bot", "tool", "activity"), msg("4", "bot", "  ")];
    const fromOrigin = conversationLines(thread, "Alpha", "Bravo", "out");
    const fromDestination = conversationLines(thread, "Bravo", "Alpha", "in");
    expect(fromOrigin).toEqual(fromDestination);
    expect(conversationLines([{ ...msg("5", "bot", "hi"), from: { botId: "a", name: "Alpha", color: "blue" } }], "Bravo", "Alpha", "in")[0]!.who).toBe("Alpha");
    expect(fromOrigin).toEqual([
      { id: "1", who: "Alpha", text: "LIST the folder" },
      { id: "2", who: "Bravo", text: "Three files" },
    ]);
  });
});
