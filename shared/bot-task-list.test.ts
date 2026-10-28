import { describe, expect, it } from "vitest";

import { canReopenBotTask, findBotTask, groupBotTasks, nextBotTaskState, parseBotTaskCreate, personBotTaskActions, sameBotTaskOwner, type BotTask } from "./bot-task-list.ts";

describe("bot task list", () => {
  it("moves doing to waiting, and either open state to done", () => {
    expect(nextBotTaskState("doing", "advance")).toBe("waiting");
    expect(nextBotTaskState("waiting", "advance")).toBeNull();
    expect(nextBotTaskState("done", "advance")).toBeNull();
    expect(nextBotTaskState("doing", "complete")).toBe("done");
    expect(nextBotTaskState("waiting", "complete")).toBe("done");
    expect(nextBotTaskState("done", "complete")).toBe("done");
  });

  it("reopens only a done task, resumes only a waiting one, and a new task may be recorded done", () => {
    expect(nextBotTaskState("done", "reopen")).toBe("doing");
    expect(nextBotTaskState("doing", "reopen")).toBeNull();
    expect(nextBotTaskState("waiting", "reopen")).toBeNull();
    expect(canReopenBotTask("done")).toBe(true);
    expect(canReopenBotTask("doing")).toBe(false);
    expect(parseBotTaskCreate({ title: "  Relire le brouillon  " })).toEqual({ ok: true, title: "Relire le brouillon", state: "doing" });
    expect(parseBotTaskCreate({ title: "Choisir", state: "waiting" })).toMatchObject({ ok: true, state: "waiting" });
    expect(parseBotTaskCreate({ title: "Fini", state: "done" })).toMatchObject({ ok: true, state: "done" });
    expect(parseBotTaskCreate({ title: "x", state: "later" }).ok).toBe(false);
    expect(parseBotTaskCreate({ title: "Choisir", note: "  deux options  " })).toMatchObject({ ok: true, note: "deux options" });
    expect(nextBotTaskState("waiting", "resume")).toBe("doing");
    expect(nextBotTaskState("doing", "resume")).toBeNull();
    expect(nextBotTaskState("done", "resume")).toBeNull();
    expect(parseBotTaskCreate({ title: "" }).ok).toBe(false);
  });
});

describe("bot task list grouping and owner", () => {
  it("puts what waits for the person first, newest first in each group", () => {
    const task = (id: string, state: BotTask["state"], updatedAt: number): BotTask => ({ id, botId: "b", title: id, state, createdAt: 0, updatedAt });
    const groups = groupBotTasks([task("a", "doing", 1), task("b", "done", 5), task("c", "waiting", 2), task("d", "waiting", 9)]);
    expect(groups.waiting.map((item) => item.id)).toEqual(["d", "c"]);
    expect(groups.doing.map((item) => item.id)).toEqual(["a"]);
    expect(groups.done.map((item) => item.id)).toEqual(["b"]);
  });

  it("compares owners without case, and an absent side matches", () => {
    expect(sameBotTaskOwner("pr_abc", "PR_ABC")).toBe(true);
    expect(sameBotTaskOwner("pr_abc", "pr_def")).toBe(false);
    expect(sameBotTaskOwner(undefined, "pr_def")).toBe(true);
    expect(sameBotTaskOwner("pr_abc", undefined)).toBe(true);
  });
});

describe("bot task references and person moves", () => {
  const task = (id: string, title: string): BotTask => ({ id, botId: "b", title, state: "doing", createdAt: 0, updatedAt: 0 });
  it("finds a task by id, else by its exact title without case, never a guess", () => {
    const list = [task("task_aaaaaa1", "Renew the domain"), task("task_aaaaaa2", "Pick a time"), task("task_aaaaaa3", "Pick a time")];
    expect(findBotTask(list, { taskId: "task_aaaaaa1" })).toBe(list[0]);
    expect(findBotTask(list, { title: "renew THE domain" })).toBe(list[0]);
    expect(findBotTask(list, { title: "Pick a time" })).toBe("ambiguous");
    expect(findBotTask(list, { title: "Renew" })).toBeNull();
    expect(findBotTask(list, { taskId: "task_missing99" })).toBeNull();
  });

  it("offers the person the moves that fit each state", () => {
    expect(personBotTaskActions("doing")).toEqual(["complete"]);
    expect(personBotTaskActions("waiting")).toEqual(["complete", "resume"]);
    expect(personBotTaskActions("done")).toEqual(["reopen"]);
  });
});
