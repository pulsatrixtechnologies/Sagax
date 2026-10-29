// A published page's shared state (shared/page-state.ts, #1544): keys,
// values and the messages between the page's frame and its wrapper.
import { describe, expect, it } from "vitest";

import { parseStateAccess, parseStateAnswer, parseStateRules, parseStateSet, STATE_DEFAULT_LEVEL, STATE_LIMITS, stateLevelFor, stateMayWrite, stateRulesOf, stateValueJson, stateWritable, validStateKey } from "./page-state.ts";

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

describe("who writes a key (2026-10-29)", () => {
  it("reads the page's own sagax-state block: levels and patterns, nothing else", () => {
    const html = `<p>x</p><script type="application/sagax-state+json">{"vote:*":"anyone","note":{"write":"signed_in"},"decision":"editors","*":"owner","bad":"admin","<x>":"anyone"}</script>`;
    expect(stateRulesOf(html)).toEqual({ "vote:*": "anyone", note: "signed_in", decision: "editors", "*": "owner" });
    expect(stateRulesOf("<script type=application/sagax-state+json>{\"a\":\"anyone\"}</script>")).toEqual({ a: "anyone" });
    expect(stateRulesOf("<script>{\"a\":\"anyone\"}</script>")).toEqual({});
    expect(stateRulesOf("<script type=\"application/sagax-state+json\">not json</script>")).toEqual({});
    expect(Object.keys(parseStateRules(Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, "anyone"]))))).toHaveLength(100);
  });

  it("a key takes its own rule, else the longest pattern, else *, else signed_in", () => {
    const rules = parseStateRules({ "vote:*": "anyone", "vote:final*": "owner", decision: "editors" });
    expect(stateLevelFor(rules, "vote:abc")).toBe("anyone");
    expect(stateLevelFor(rules, "vote:final-1")).toBe("owner");
    expect(stateLevelFor(rules, "decision")).toBe("editors");
    expect(stateLevelFor(rules, "other")).toBe(STATE_DEFAULT_LEVEL);
    expect(stateLevelFor({ ...rules, "*": "anyone" }, "other")).toBe("anyone");
  });

  it("each level, always within the sharing; a read-only key for nobody", () => {
    const open = { publicLink: true, locked: false };
    const closed = { publicLink: false, locked: false };
    expect(stateMayWrite("anon", "anyone", open)).toBe(true);
    expect(stateMayWrite("anon", "anyone", closed)).toBe(false);
    for (const level of ["signed_in", "editors", "owner"] as const) expect(stateMayWrite("anon", level, open)).toBe(false);
    expect(stateMayWrite("signed_in", "anyone", closed)).toBe(true);
    expect(stateMayWrite("signed_in", "signed_in", closed)).toBe(true);
    expect(stateMayWrite("signed_in", "editors", open)).toBe(false);
    expect(stateMayWrite("editor", "editors", open)).toBe(true);
    expect(stateMayWrite("editor", "owner", open)).toBe(false);
    expect(stateMayWrite("owner", "owner", open)).toBe(true);
    expect(stateMayWrite("owner", "anyone", { publicLink: true, locked: true })).toBe(false);
  });

  it("stateWritable: one key, or at least one", () => {
    const access = { role: "anon" as const, rules: { "vote:*": "anyone" as const }, locked: [], publicLink: true };
    expect(stateWritable(access)).toBe(true);
    expect(stateWritable(access, "vote:x")).toBe(true);
    expect(stateWritable(access, "note")).toBe(false);
    expect(stateWritable({ ...access, rules: {} })).toBe(false);
    expect(stateWritable({ ...access, role: "signed_in", rules: {} })).toBe(true);
    expect(parseStateAccess({ role: "anon", rules: { a: "anyone" }, locked: ["a", "<x>"], publicLink: true })).toEqual({ role: "anon", rules: { a: "anyone" }, locked: ["a"], publicLink: true });
    expect(parseStateAccess({ role: "admin" })).toBeNull();
  });
});
