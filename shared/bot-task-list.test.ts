import { describe, expect, it } from "vitest";

import { canReopenBotTask, nextBotTaskState, parseBotTaskCreate } from "./bot-task-list.ts";

describe("bot task list", () => {
  it("moves doing to waiting, and either open state to done", () => {
    expect(nextBotTaskState("doing", "advance")).toBe("waiting");
    expect(nextBotTaskState("waiting", "advance")).toBeNull();
    expect(nextBotTaskState("done", "advance")).toBeNull();
    expect(nextBotTaskState("doing", "complete")).toBe("done");
    expect(nextBotTaskState("waiting", "complete")).toBe("done");
    expect(nextBotTaskState("done", "complete")).toBe("done");
  });

  it("reopens only a done task, and a new task is never created done", () => {
    expect(nextBotTaskState("done", "reopen")).toBe("doing");
    expect(nextBotTaskState("doing", "reopen")).toBeNull();
    expect(nextBotTaskState("waiting", "reopen")).toBeNull();
    expect(canReopenBotTask("done")).toBe(true);
    expect(canReopenBotTask("doing")).toBe(false);
    expect(parseBotTaskCreate({ title: "  Relire le brouillon  " })).toEqual({ ok: true, title: "Relire le brouillon", state: "doing" });
    expect(parseBotTaskCreate({ title: "Choisir", state: "waiting" })).toMatchObject({ ok: true, state: "waiting" });
    expect(parseBotTaskCreate({ title: "Fini", state: "done" }).ok).toBe(false);
    expect(parseBotTaskCreate({ title: "" }).ok).toBe(false);
  });
});
