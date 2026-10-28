import { describe, expect, it } from "vitest";
import type { Bot, Task } from "@/state/store";
import { backgroundTasks, finishedCount } from "./tasks";

const link = (threadId: string, extra: Record<string, unknown> = {}) => ({ threadId, messageId: "m", at: 1_000, ...extra });
const task = (threadId: string, title: string, parallelOf: ReturnType<typeof link>, extra: Partial<Task> = {}): Task => ({ threadId, title, createdAt: 1, parallelOf, ...extra } as Task);
const bot = (tasks: Task[]): Bot => ({ id: "dev", threadId: "conv", tasks } as Bot);

describe("background tasks", () => {
  it("lists only this conversation's tasks, running first, with how long they ran", () => {
    const tasks = backgroundTasks({
      bot: bot([
        task("done-1", "Old", link("conv", { outcome: "done", reportedAt: 4_000 })),
        task("run-1", "Live", link("conv"), { busy: true, turnStartedAt: 500 }),
        task("other", "Elsewhere", link("another")),
      ]),
      task: undefined,
    }, 2_000);
    expect(tasks.map((entry) => entry.threadId)).toEqual(["run-1", "done-1"]);
    expect(tasks[0]).toMatchObject({ state: "running", live: true, elapsed: 1_500 });
    expect(tasks[1]).toMatchObject({ state: "done", live: false, elapsed: 3_000 });
    expect(finishedCount(tasks)).toBe(1);
  });

  it("counts a failed task as finished and a waiting one as still going", () => {
    const tasks = backgroundTasks({
      bot: bot([
        task("bad", "Bad", link("conv", { outcome: "failed", reportedAt: 2_000 })),
        task("ask", "Ask", link("conv"), { activity: "waiting-on-you" }),
      ]),
      task: undefined,
    }, 3_000);
    expect(tasks.find((entry) => entry.threadId === "ask")).toMatchObject({ state: "waiting", live: true });
    expect(finishedCount(tasks)).toBe(1);
  });

  it("points at the task's result once it reported back in this conversation", () => {
    const [entry] = backgroundTasks({
      bot: bot([task("done-1", "Old", link("conv", { outcome: "done", reportedAt: 4_000 }))]),
      task: undefined,
      messages: [{ id: "r1", role: "bot", kind: "text", text: "done", at: 5, parallelTask: { threadId: "done-1", title: "Old", requestMessageId: "m", role: "result" } }] as never,
    }, 5_000);
    expect(entry).toMatchObject({ threadId: "done-1", resultMessageId: "r1" });
  });

  it("is empty when the conversation has no background task", () => {
    expect(backgroundTasks({ bot: bot([]), task: undefined }, 1)).toEqual([]);
  });
});
