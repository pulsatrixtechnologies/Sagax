import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRESH_TOPIC_AFTER_DEFAULT_HOURS, freshTopicAfterMs, freshTopicOnReturn, parseFreshTopicAfter, type FreshTopicInput } from "./fresh-topic";

type Vector = FreshTopicInput & { name: string; fresh: boolean; reason: string };
// The same cases run on the phone (ios CompanionCore FreshTopicTests).
const vectors = (JSON.parse(readFileSync(new URL("./fresh-topic.vectors.json", import.meta.url), "utf8")) as { cases: Vector[] }).cases;

describe("freshTopicOnReturn", () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))("%s", (_name, vector) => {
    expect(freshTopicOnReturn(vector)).toEqual({ fresh: vector.fresh, reason: vector.reason });
  });

  it("covers every reason in the shared vectors", () => {
    expect(new Set(vectors.map((vector) => vector.reason))).toEqual(new Set(["idle", "away", "never", "no-topic", "untouched", "live", "waiting", "unread", "seen", "recent"]));
  });
});

describe("the threshold setting", () => {
  it("defaults to 4 h and reads only the offered choices", () => {
    expect(FRESH_TOPIC_AFTER_DEFAULT_HOURS).toBe(4);
    expect(parseFreshTopicAfter(null)).toBe(4);
    expect(parseFreshTopicAfter("")).toBe(4);
    expect(parseFreshTopicAfter("3")).toBe(4);
    expect(parseFreshTopicAfter("abc")).toBe(4);
    expect(parseFreshTopicAfter("8")).toBe(8);
    expect(parseFreshTopicAfter("0")).toBe(0);
    expect(freshTopicAfterMs(4)).toBe(4 * 3_600_000);
    expect(freshTopicAfterMs(0)).toBe(0);
  });
});
