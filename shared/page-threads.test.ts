// Annotations (shared/page-threads.ts): anchors and messages from the page's
// frame are checked and cut; threads are ordered as the page shows them.
import { describe, expect, it } from "vitest";

import { applySuggestion, commentsForModel, orderThreads, parseSuggestion, suggestable, parseFocusMessage, parseFoundMessage, parsePageQuote, parseSelectMessage, parseThreadText, THREAD_LIMITS } from "./page-threads.ts";

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

describe("commentsForModel", () => {
  it("names people, says what each comment is about and which are new to the bot", () => {
    const threads = [
      { id: "t1", at: 1000, by: "pr_a", version: 1, text: "Vieux", replies: [], anchor: { kind: "text" as const, quote: "Demandes", prefix: "", suffix: "", path: "body", tag: "p" } },
      { id: "t2", at: 500, by: "pr_b", version: 1, text: "Partie", replies: [{ id: "r", at: 3000, by: "bot:b1", text: "Vu" }], resolved: { at: 3000, by: "pr_b" },
        anchor: { kind: "element" as const, quote: "Réseau 31", prefix: "", suffix: "", path: "body > tr", tag: "tr" } },
    ];
    const names = (id: string) => ({ pr_a: "A", pr_b: "B", "bot:b1": "Scout" } as Record<string, string>)[id] ?? "";
    expect(commentsForModel(threads, names, 2000)).toEqual([
      { threadId: "t1", on: "Demandes", by: "A", text: "Vieux", at: new Date(1000).toISOString(), resolved: false, replies: [] },
      { threadId: "t2", on: "<tr> Réseau 31", by: "B", text: "Partie", at: new Date(500).toISOString(), resolved: true, new: true, replies: [{ by: "Scout", text: "Vu", at: new Date(3000).toISOString() }] },
    ]);
    expect(commentsForModel(threads, names).every((entry) => entry.new)).toBe(true);
  });
});

describe("suggested edits", () => {
  it("replaces the quoted words once, the right occurrence by its context", () => {
    expect(applySuggestion("# Bilan\n\nLe volume a augmenté.", { quote: "a augmenté", prefix: "", suffix: "" }, "a doublé")).toEqual({ ok: true, content: "# Bilan\n\nLe volume a doublé." });
    const twice = "Réseau : 12 postes.\n\nTotal : 12 postes.";
    expect(applySuggestion(twice, { quote: "12 postes", prefix: "Total : ", suffix: "." }, "14 postes")).toEqual({ ok: true, content: "Réseau : 12 postes.\n\nTotal : 14 postes." });
    expect(applySuggestion(twice, { quote: "12 postes", prefix: "", suffix: "." }, "x")).toEqual({ ok: false, reason: "ambiguous" });
    // the rendered words no longer in the source (formatting, a later version)
    expect(applySuggestion("Le **volume** a augmenté.", { quote: "volume a augmenté", prefix: "", suffix: "" }, "x")).toEqual({ ok: false, reason: "not_found" });
  });

  it("a suggestion is new words for Markdown and slides only", () => {
    expect(parseSuggestion("a doublé", "a augmenté")).toBe("a doublé");
    expect(parseSuggestion("", "a augmenté")).toBe("");
    expect(parseSuggestion("a augmenté", "a augmenté")).toBeNull();
    expect(parseSuggestion("x".repeat(THREAD_LIMITS.suggestionChars + 1), "q")).toBeNull();
    expect(parseSuggestion("a\r\nb", "q")).toBe("a\nb");
    expect(suggestable("markdown") && suggestable("presentation")).toBe(true);
    expect(suggestable("html")).toBe(false);
  });
});
