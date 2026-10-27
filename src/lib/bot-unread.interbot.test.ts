// Owner's rule: bot-to-bot threads are never shown to the person (sidebar,
// typing dots, unread counts, notifications).
import { describe, expect, it } from "vitest";
import { botShowsUnread, isInterBotThread, taskHiddenFromSidebar } from "./bot-unread";

const work = { threadId: "w", unread: true, openedBy: { botId: "quasar" } };
describe("bot-to-bot threads", () => {
  it("are hidden from the sidebar of the bot they were opened on", () => {
    expect(isInterBotThread("agreements", work)).toBe(true);
    expect(taskHiddenFromSidebar(work, "agreements")).toBe(true);
    // a bot's own thread is not one
    expect(isInterBotThread("quasar", work)).toBe(false);
    expect(taskHiddenFromSidebar({}, "agreements")).toBe(false);
  });

  it("never light the bot's unread dot", () => {
    expect(botShowsUnread({ id: "agreements", tasks: [work, { unread: false }] })).toBe(false);
    expect(botShowsUnread({ id: "agreements", tasks: [work, { unread: true }] })).toBe(true);
  });
});
