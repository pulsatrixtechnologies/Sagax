import { describe, expect, it } from "vitest";
import { isEarlierSegment, segmentsAbove, segmentsToReach, streamHomeThread } from "./single-stream";

const tasks = [
  { threadId: "b", createdAt: 20 },
  { threadId: "a", createdAt: 10 },
  { threadId: "conf", createdAt: 25, confidential: true as const },
  { threadId: "job", createdAt: 26, openedBy: { botId: "x" } },
  { threadId: "run", createdAt: 27, routineRunId: "r" },
  { threadId: "c", createdAt: 30 },
];

describe("single stream navigation", () => {
  it("opens at the newest segment, never at a confidential, bot-opened or routine thread", () => {
    expect(streamHomeThread(tasks)).toBe("c");
    expect(streamHomeThread([])).toBeUndefined();
    expect(streamHomeThread([{ threadId: "conf", createdAt: 1, confidential: true }])).toBeUndefined();
  });

  it("knows an earlier segment from the newest one and from threads outside the stream", () => {
    expect(isEarlierSegment(tasks, "a")).toBe(true);
    expect(isEarlierSegment(tasks, "c")).toBe(false);
    expect(isEarlierSegment(tasks, "conf")).toBe(false);
    expect(isEarlierSegment(tasks, "job")).toBe(false);
    expect(isEarlierSegment(tasks, "gone")).toBe(false);
  });

  it("lists the topics above a segment newest first, and how many to load to reach one", () => {
    expect(segmentsAbove(tasks, "c").map((task) => task.threadId)).toEqual(["b", "a"]);
    expect(segmentsToReach(tasks, "c", "b")).toBe(1);
    expect(segmentsToReach(tasks, "c", "a")).toBe(2);
    expect(segmentsToReach(tasks, "c", "conf")).toBe(0);
    expect(segmentsAbove(tasks, "conf")).toEqual([]);
  });

  it("keeps a New topic just started here, and never strands the person on an empty one from elsewhere", () => {
    const fresh = [...tasks, { threadId: "new", createdAt: 40, updatedAt: 40 }];
    expect(streamHomeThread(fresh, "new")).toBe("new");
    expect(streamHomeThread(fresh, "c")).toBe("c");
    expect(streamHomeThread([...tasks, { threadId: "new", createdAt: 40, updatedAt: 40, busy: true }], "c")).toBe("new");
  });
});
