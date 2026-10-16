import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { confidentialTitle, isConfidentialTask, makeConfidentialBody, newThreadChoices, openThreadConfidential } from "@/lib/confidential-thread";
import { formatTranscriptMarkdown } from "@/lib/export-transcript";
import { CONFIDENTIAL_BANNER_HEIGHT, ConfidentialBadge, ConfidentialBanner } from "./ConfidentialBanner";

afterEach(() => setLocale("en"));

describe("ConfidentialBanner", () => {
  it("is a note band with the mark, the lock and the screen reader sentence", () => {
    const html = renderToStaticMarkup(createElement(ConfidentialBanner, { position: "top" }));
    expect(html).toMatch(/^<div role="note" data-confidential-banner="top"/);
    expect(html).toContain(`height:${CONFIDENTIAL_BANNER_HEIGHT}px`);
    expect(html).toContain("bg-confidential");
    expect(html).toContain("uppercase");
    expect(html).toContain("lucide-lock");
    expect(html).toContain('class="sr-only">Confidential thread: this thread is not remembered, not exported and not shared');
    expect(html).not.toMatch(/<button/);
  });

  it("speaks Quebec French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(ConfidentialBanner, { position: "bottom" }));
    expect(html).toContain(">Confidentiel<");
    expect(html).toContain("Fil confidentiel : ce fil n&#x27;est ni mémorisé, ni exporté, ni partagé");
  });

  it("has no dismiss control and takes no props that could hide it", () => {
    // Only position and className: no onClose, no open flag.
    const html = renderToStaticMarkup(createElement(ConfidentialBanner, { position: "top", className: "x" }));
    expect(html).not.toMatch(/aria-label="(Close|Dismiss)/i);
  });

  it("the badge carries the lock and the word", () => {
    const html = renderToStaticMarkup(createElement(ConfidentialBadge));
    expect(html).toContain("data-confidential-badge");
    expect(html).toContain(">Confidential<");
  });
});

describe("confidential thread helpers", () => {
  it("makes a thread confidential with the confirmation, and has no body that turns it off", () => {
    expect(makeConfidentialBody()).toEqual({ confidential: true, confirmConfidential: true });
  });

  it("reads the open thread", () => {
    expect(openThreadConfidential({ threadId: "a", tasks: [{ threadId: "a", confidential: true }] })).toBe(true);
    expect(openThreadConfidential({ threadId: "b", tasks: [{ threadId: "a", confidential: true }, { threadId: "b" }] })).toBe(false);
    expect(isConfidentialTask(undefined)).toBe(false);
  });

  it("offers both kinds of new thread, the organization default first", () => {
    expect(newThreadChoices(false).map((choice) => [choice.label, choice.confidential])).toEqual([["task.newShort", false], ["confidential.new", true]]);
    expect(newThreadChoices(true).map((choice) => [choice.label, choice.confidential])).toEqual([["confidential.new", true], ["confidential.newOrdinary", false]]);
  });

  it("marks the window title", () => {
    expect(confidentialTitle("Sagax", true, "Confidential")).toBe("🔒 Confidential · Sagax");
    expect(confidentialTitle("Sagax", false, "Confidential")).toBe("Sagax");
  });

  it("stamps an export of a confidential thread at its top and end", () => {
    const markdown = formatTranscriptMarkdown({ title: "Pepper", messages: [{ id: "m", role: "user", kind: "text", text: "hi", at: 1 }] as never, confidentialMark: "Confidentiel", exportedAt: new Date(0) });
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("> **🔒 CONFIDENTIEL**");
    expect(lines.at(-1)).toBe("> **🔒 CONFIDENTIEL**");
    expect(formatTranscriptMarkdown({ title: "Pepper", messages: [], exportedAt: new Date(0) })).not.toContain("🔒");
  });
});
