// Annotations (shared/page-threads.ts): anchors and messages from the page's
// frame are checked and cut; threads are ordered as the page shows them.
import { describe, expect, it } from "vitest";

import { orderThreads, parseFocusMessage, parseFoundMessage, parsePageQuote, parseSelectMessage, parseThreadText, THREAD_LIMITS } from "./page-threads.ts";

describe("anchors and texts", () => {
  it("cuts every field and refuses a bad tag or an empty quote", () => {
    const quote = parsePageQuote({ kind: "text", quote: "q".repeat(900), prefix: "p".repeat(200), suffix: "s", path: " body  >  p ", tag: "P" })!;
    expect(quote.quote).toHaveLength(THREAD_LIMITS.quoteChars);
    expect(quote.prefix).toHaveLength(THREAD_LIMITS.contextChars);
    expect(quote).toMatchObject({ path: "body > p", tag: "p" });
    expect(parsePageQuote({ kind: "text", quote: " ", path: "", tag: "p" })).toBeNull();
    expect(parsePageQuote({ kind: "text", quote: "x", path: "", tag: "<p>" })).toBeNull();
    expect(parsePageQuote({ kind: "zone", quote: "x", tag: "p" })).toBeNull();
    expect(parsePageQuote({ kind: "element", quote: "", path: "body > tr", tag: "tr" })).not.toBeNull();
  });

  it("a comment is 1 to 2000 characters", () => {
    expect(parseThreadText("  ok ")).toBe("ok");
    expect(parseThreadText(" ")).toBeNull();
    expect(parseThreadText("x".repeat(2001))).toBeNull();
  });
});

describe("messages from the frame", () => {
  it("only well-formed ones", () => {
    expect(parseSelectMessage({ type: "sagax-annotate-select", v: 1, anchor: { kind: "text", quote: "a", tag: "p" } })).toMatchObject({ quote: "a" });
    expect(parseSelectMessage({ type: "sagax-annotate-select", v: 2, anchor: { kind: "text", quote: "a", tag: "p" } })).toBeNull();
    expect(parseFocusMessage({ type: "sagax-annotate-focus", v: 1, id: "abc_1" })).toBe("abc_1");
    expect(parseFocusMessage({ type: "sagax-annotate-focus", v: 1, id: "a\"]" })).toBeNull();
    expect(parseFoundMessage({ type: "sagax-annotate-found", v: 1, ids: ["a", 3, "b"] })).toEqual(["a", "b"]);
  });
});

describe("orderThreads", () => {
  it("open first in page order, unknown last, then resolved", () => {
    const threads = [
      { id: "late", at: 3 }, { id: "done", at: 0, resolved: { at: 1, by: "x" } }, { id: "second", at: 1 }, { id: "first", at: 2 },
    ];
    expect(orderThreads(threads, ["first", "done", "second"]).map((thread) => thread.id)).toEqual(["first", "second", "late", "done"]);
  });
});
