import { describe, expect, it } from "vitest";
import type { Bot, Task } from "@/state/store";
import { isUntouchedThread, latestConversation, openBotConversationActions, threadsOffOpenTarget, threadsOffReturnTarget } from "./thread-home";

const main: Task = { threadId: "main", title: "Main", createdAt: 1, updatedAt: 50 };
const older: Task = { threadId: "older", title: "Older", createdAt: 2, updatedAt: 10 };
const extra: Task = { threadId: "extra", title: "Untitled", createdAt: 60, updatedAt: 60 };
const bot = (threadId: string, tasks: Task[], messages: Bot["messages"] = []) => ({ id: "vega", threadId, tasks, messages });

describe("thread home while threads are hidden", () => {
  it("treats a thread as untouched only while nothing was written and nothing runs", () => {
    expect(isUntouchedThread(extra)).toBe(true);
    expect(isUntouchedThread({ ...extra, updatedAt: undefined })).toBe(false);
    expect(isUntouchedThread(main)).toBe(false);
    expect(isUntouchedThread({ ...extra, busy: true })).toBe(false);
    expect(isUntouchedThread({ ...extra, activity: "waiting-on-you" })).toBe(false);
    expect(isUntouchedThread({ ...extra, unread: true })).toBe(false);
    expect(isUntouchedThread(extra, bot("extra", [extra], [{ id: "m", role: "user", text: "hi", at: 60 } as Bot["messages"][number]]))).toBe(false);
  });

  it("finds the latest conversation with content, routine runs excluded", () => {
    expect(latestConversation(bot("extra", [older, main, extra, { threadId: "run", title: "Run", createdAt: 3, updatedAt: 99, routineRunId: "r" }]))).toBe("main");
    expect(latestConversation(bot("extra", [extra]))).toBeUndefined();
  });

  it("keeps the last selected conversation when it has content", () => {
    expect(threadsOffOpenTarget(bot("older", [older, main]))).toBeUndefined();
    expect(openBotConversationActions(bot("older", [older, main]), false)).toEqual([{ type: "select", id: "vega" }]);
    // the header still offers the newer one
    expect(threadsOffReturnTarget(bot("older", [older, main]))).toBe("main");
  });

  it("recovers from an untouched extra thread created while threads were off", () => {
    const trapped = bot("extra", [main, older, extra]);
    expect(threadsOffOpenTarget(trapped)).toBe("main");
    expect(openBotConversationActions(trapped, false)).toEqual([
      { type: "select", id: "vega" },
      { type: "switchTask", botId: "vega", threadId: "main" },
    ]);
  });

  it("leaves the threads-on row alone and never offers a return when already home", () => {
    expect(openBotConversationActions(bot("extra", [main, extra]), true)).toEqual([{ type: "select", id: "vega" }]);
    expect(threadsOffReturnTarget(bot("main", [main, older]))).toBeUndefined();
    expect(threadsOffOpenTarget(bot("extra", [extra]))).toBeUndefined();
    expect(threadsOffOpenTarget({ threadId: "solo" })).toBeUndefined();
  });
});
