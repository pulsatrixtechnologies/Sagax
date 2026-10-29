// A published page's shared state (shared/page-state.ts, #1544): keys,
// values and the messages between the page's frame and its wrapper.
import { describe, expect, it } from "vitest";

import { parseStateAnswer, parseStateSet, STATE_LIMITS, stateValueJson, validStateKey } from "./page-state.ts";

describe("keys and values", () => {
  it("a key is a short name", () => {
    for (const key of ["ticket:4242", "row/12", "À reprendre", "mark#3"]) expect(validStateKey(key), key).toBe(true);
    for (const key of ["", "x".repeat(STATE_LIMITS.keyChars + 1), "a\nb", "<script>", 3]) expect(validStateKey(key)).toBe(false);
  });

  it("a value is plain JSON data within the size limit", () => {
    expect(stateValueJson({ taken: true, by: "x" })).toBe('{"taken":true,"by":"x"}');
    expect(stateValueJson(null)).toBe("null");
    expect(stateValueJson(undefined)).toBeNull();
    expect(stateValueJson("x".repeat(STATE_LIMITS.valueBytes))).toBeNull();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(stateValueJson(loop)).toBeNull();
  });
});

describe("messages", () => {
  it("a set from the frame is checked", () => {
    expect(parseStateSet({ type: "sagax-state-set", v: 1, id: 3, key: "ticket:1", value: { taken: true } })).toEqual({ id: 3, key: "ticket:1", value: { taken: true } });
    expect(parseStateSet({ type: "sagax-state-set", v: 1, id: -1, key: "k", value: 1 })).toBeNull();
    expect(parseStateSet({ type: "sagax-state-set", v: 1, id: 1, key: "", value: 1 })).toBeNull();
    expect(parseStateSet({ type: "sagax-state-set", v: 1, id: 1, key: "k" })).toBeNull();
  });

  it("an answer keeps names and values, never anything else", () => {
    expect(parseStateAnswer({ entries: { a: { value: 1, name: "N", at: 5, by: "pr_x" }, "<bad>": { value: 1, name: "N", at: 5 }, b: { value: 2 } } })).toEqual({ a: { value: 1, name: "N", at: 5 } });
    expect(parseStateAnswer({})).toBeNull();
  });
});
