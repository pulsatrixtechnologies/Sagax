// One conversation per bot (Settings > Conversation threads > One
// conversation): no other thread is ever a destination nor a sidebar line.
// A parallel task's detail, a bot's job or a run opens in the side column
// beside the conversation, which stays on screen where it was; Close or
// Escape is the way back. Every unread thread adds to the bot's one badge,
// and the conversation on screen reads the topics it holds.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, Bot } from "./store";

const prefs = vi.hoisted(() => ({ singleStream: true }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/thread-preferences")>();
  return { ...original, singleStreamTurnField: () => ({ singleStream: prefs.singleStream }) };
});

const { openThread, opensBesideStream, threadsReadOnScreen } = await import("./store");
const { closeSideThread, currentSideThread } = await import("@/lib/side-thread");
const { botUnreadCount } = await import("@/lib/bot-unread");
const { streamUnreadReadWith } = await import("@/lib/single-stream");

afterEach(() => { closeSideThread(); prefs.singleStream = true; });

const helper = (): Bot => ({
  id: "helper", threadId: "now", name: "Helper", title: "", description: "", notifications: true, unread: true,
  color: "green", modelSelection: { instanceId: "fake", model: "m" }, messages: [],
  tasks: [
    { threadId: "earlier", title: "hello", createdAt: 1, unread: true },
    { threadId: "now", title: "Now", createdAt: 2 },
    { threadId: "sub-a", title: "Sub-task A", createdAt: 3, unread: true, parallelOf: { threadId: "now", messageId: "m", at: 3 } },
    { threadId: "sub-b", title: "Sub-task B", createdAt: 4, parallelOf: { threadId: "now", messageId: "m", at: 4 } },
    { threadId: "job", title: "Job", createdAt: 5, unread: true, openedBy: { botId: "helper", name: "Helper", at: 5 } },
  ],
} as Bot);

describe("a sub-task's detail with threads hidden", () => {
  it("opens beside the conversation and never switches the conversation on screen", () => {
    const bot = helper();
    const actions: Action[] = [];
    const opened = openThread((action) => actions.push(action), { botId: bot.id, threadId: "sub-b" }, { bots: [bot], groups: [] } as never, false);
    expect(opened).toBe(true);
    expect(actions.some((action) => action.type === "switchTask")).toBe(false);
    expect(currentSideThread()).toEqual({ botId: "helper", threadId: "sub-b" });
    // the second sub-task replaces the first in the column; the conversation stays
    openThread((action) => actions.push(action), { botId: bot.id, threadId: "sub-a" }, { bots: [bot], groups: [] } as never, false);
    expect(actions.some((action) => action.type === "switchTask")).toBe(false);
    expect(currentSideThread()).toEqual({ botId: "helper", threadId: "sub-a" });
    // the way back: closing the column leaves the conversation where it was
    closeSideThread();
    expect(currentSideThread()).toBeNull();
  });

  it("switches to it with threads shown, as a thread is a destination there", () => {
    const bot = helper();
    const actions: Action[] = [];
    openThread((action) => actions.push(action), { botId: bot.id, threadId: "sub-b" }, { bots: [bot], groups: [] } as never, true);
    expect(actions).toContainEqual({ type: "switchTask", botId: "helper", threadId: "sub-b" });
    expect(currentSideThread()).toBeNull();
  });

  it("opens beside only what is outside the stream, never the thread on screen", () => {
    const bot = helper();
    expect(opensBesideStream(bot, "sub-a")).toBe(true);
    expect(opensBesideStream(bot, "job")).toBe(true);
    expect(opensBesideStream(bot, "earlier")).toBe(false);
    expect(opensBesideStream(bot, "now")).toBe(false);
  });
});

describe("unread with threads hidden", () => {
  it("adds every unread thread to the bot's one count", () => {
    const bot = helper();
    // nothing unread on screen: the three unread threads elsewhere
    expect(botUnreadCount(bot, [], false)).toBe(3);
    // with threads shown, those threads have rows of their own
    expect(botUnreadCount(bot, [], true)).toBeNull();
    const onScreen = { ...bot, tasks: bot.tasks!.map((task) => task.threadId === "now" ? { ...task, unread: true } : task) };
    const lines = [
      { id: "u", role: "user" as const, text: "go" },
      { id: "b1", role: "bot" as const, text: "one" },
      { id: "b2", role: "bot" as const, text: "two" },
    ];
    expect(botUnreadCount(onScreen, lines, false)).toBe(5);
  });

  it("reads the topics and sub-tasks the conversation on screen holds, never a thread kept apart", () => {
    const bot = helper();
    expect(streamUnreadReadWith(bot.tasks, "now")).toEqual(["earlier", "sub-a"]);
    expect(threadsReadOnScreen(bot, "now")).toEqual(["now", "earlier", "sub-a"]);
    // a thread outside the stream on screen reads itself only
    expect(streamUnreadReadWith(bot.tasks, "job")).toEqual([]);
    prefs.singleStream = false;
    expect(threadsReadOnScreen(bot, "now")).toEqual(["now"]);
  });
});
