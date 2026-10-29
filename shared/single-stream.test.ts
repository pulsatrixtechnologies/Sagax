import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  conversationThread, conversationThreadId, earlierSegments, isEarlierStreamSegment, isStreamSegment, latestSegment,
  opensBesideConversation, streamSegments, type StreamTaskFacts,
} from "./single-stream.ts";

const t = (threadId: string, createdAt: number, extra: Record<string, unknown> = {}) => ({ threadId, createdAt, ...extra });

describe("single stream segments (thread mode off)", () => {
  it("keeps only a person's conversations: never routine runs, hidden, confidential, bot-opened, parallel, archived or closed threads", () => {
    expect(isStreamSegment(t("a", 1))).toBe(true);
    expect(isStreamSegment(t("r", 1, { routineRunId: "run" }))).toBe(false);
    expect(isStreamSegment(t("h", 1, { hidden: true }))).toBe(false);
    expect(isStreamSegment(t("c", 1, { confidential: true }))).toBe(false);
    expect(isStreamSegment(t("o", 1, { openedBy: { botId: "b", name: "B", at: 1 } }))).toBe(false);
    expect(isStreamSegment(t("p", 1, { parallelOf: { threadId: "a" } }))).toBe(false);
    expect(isStreamSegment(t("x", 1, { archivedAt: 9 }))).toBe(false);
    expect(isStreamSegment(t("z", 1, { closedBy: { botId: "b", name: "B", at: 2 } }))).toBe(false);
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

// 2026-10-22 (owner: "everything should be unified in a single chat page").
describe("a routine results thread in the stream", () => {
  it("is not a segment, so it never becomes the stream's home", () => {
    const tasks = [
      { threadId: "chat", createdAt: 1 },
      { threadId: "results", createdAt: 2, routineResults: true as const },
    ];
    expect(isStreamSegment(tasks[1]!)).toBe(false);
    expect(latestSegment(tasks)?.threadId).toBe("chat");
  });
});

// The one conversation: the same answer on the server, the desktop and the
// phone. The phone runs the same file (SingleStreamTests.swift).
interface Vector {
  name: string;
  tasks: StreamTaskFacts[];
  segments: string[];
  conversation: string | null;
  earlier: string[];
  beside: string[];
}

const vectors = JSON.parse(readFileSync(new URL("./single-stream.vectors.json", import.meta.url), "utf8")) as { cases: Vector[] };

describe("the one conversation (shared/single-stream.vectors.json)", () => {
  for (const vector of vectors.cases) {
    it(vector.name, () => {
      expect(streamSegments(vector.tasks).map((task) => task.threadId)).toEqual(vector.segments);
      expect(conversationThreadId(vector.tasks) ?? null).toBe(vector.conversation);
      expect(conversationThread(vector.tasks)?.threadId ?? null).toBe(vector.conversation);
      const home = vector.conversation;
      expect(home ? earlierSegments(vector.tasks, home).map((task) => task.threadId) : []).toEqual(vector.earlier);
      for (const task of vector.tasks) {
        expect(opensBesideConversation(vector.tasks, task.threadId), `${task.threadId} beside`).toBe(vector.beside.includes(task.threadId));
        expect(isEarlierStreamSegment(vector.tasks, task.threadId), `${task.threadId} earlier`).toBe(vector.earlier.includes(task.threadId));
      }
      expect(opensBesideConversation(vector.tasks, "unknown")).toBe(false);
    });
  }

  it("the tasks of every case come in any order and still give the same answer", () => {
    for (const vector of vectors.cases) {
      const reversed = [...vector.tasks].reverse();
      expect(conversationThreadId(reversed) ?? null).toBe(vector.conversation);
      expect(streamSegments(reversed).map((task) => task.threadId)).toEqual(vector.segments);
    }
  });
});
