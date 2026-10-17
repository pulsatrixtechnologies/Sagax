import { describe, expect, it } from "vitest";
import { earlierSegments, isStreamSegment, latestSegment, streamSegments } from "./single-stream.ts";

const t = (threadId: string, createdAt: number, extra: Record<string, unknown> = {}) => ({ threadId, createdAt, ...extra });

describe("single stream segments (thread mode off)", () => {
  it("keeps only a person's conversations: never routine runs, hidden, confidential, bot-opened or parallel threads", () => {
    expect(isStreamSegment(t("a", 1))).toBe(true);
    expect(isStreamSegment(t("r", 1, { routineRunId: "run" }))).toBe(false);
    expect(isStreamSegment(t("h", 1, { hidden: true }))).toBe(false);
    expect(isStreamSegment(t("c", 1, { confidential: true }))).toBe(false);
    expect(isStreamSegment(t("o", 1, { openedBy: { botId: "b", name: "B", at: 1 } }))).toBe(false);
    expect(isStreamSegment(t("p", 1, { parallelOf: { threadId: "a" } }))).toBe(false);
  });

  it("orders segments oldest first, whatever order the tasks come in", () => {
    const tasks = [t("c", 30), t("a", 10), t("conf", 15, { confidential: true }), t("b", 20)];
    expect(streamSegments(tasks).map((task) => task.threadId)).toEqual(["a", "b", "c"]);
    expect(latestSegment(tasks)?.threadId).toBe("c");
    expect(earlierSegments(tasks, "c").map((task) => task.threadId)).toEqual(["a", "b"]);
    expect(earlierSegments(tasks, "a")).toEqual([]);
  });

  it("draws nothing before a thread that is not a segment (a confidential thread stays alone)", () => {
    const tasks = [t("a", 10), t("conf", 15, { confidential: true })];
    expect(earlierSegments(tasks, "conf")).toEqual([]);
    expect(streamSegments(undefined)).toEqual([]);
  });
});
