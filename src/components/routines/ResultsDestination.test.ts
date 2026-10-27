import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const threads = vi.hoisted(() => ({ show: true }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => threads.show }));

const { ResultsDestination } = await import("./ResultsDestination");

const bot = {
  id: "pepper", projects: [{ id: "management", name: "OMB management" }],
  tasks: [
    { threadId: "main", title: "Everyday chat" },
    { threadId: "health", title: "Fleet health", projectId: "management" },
    { threadId: "execution", title: "Internal run", routineRunId: "run-1" },
  ],
} as Bot;

describe("routine result destination", () => {
  it("offers a dedicated thread or visible conversations grouped by folder", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: null, onChange: vi.fn() }));
    expect(html).toContain("Post results to");
    expect(html).toContain('value="new" selected=""');
    expect(html).toContain('label="OMB management"');
    expect(html).toContain("Fleet health");
    expect(html).toContain("Everyday chat");
    expect(html).not.toContain("Internal run");
    expect(html).not.toContain("Keep current destination");
    expect(html).toContain("unless you choose another");
  });

  it("in one conversation (threads hidden) offers only the bot's main thread", () => {
    threads.show = false;
    try {
      const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: null, onChange: vi.fn() }));
      expect(html).toContain("The bot&#x27;s main thread");
      expect(html).not.toContain("Fleet health");
      expect(html).not.toContain("Everyday chat");
      expect(html).not.toContain("unless you choose another");
      expect(html).toContain("Run logs");
    } finally {
      threads.show = true;
    }
  });

  it("preserves a legacy destination on unrelated edits", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: undefined, allowCurrent: true, onChange: vi.fn() }));
    expect(html).toContain('value="current" selected=""');
    expect(html).toContain("Keep current destination");
  });

  it("shows an unavailable selection honestly instead of silently choosing another account's thread", () => {
    const html = renderToStaticMarkup(createElement(ResultsDestination, { bot, value: "deleted-or-foreign", onChange: vi.fn() }));
    expect(html).toContain("Thread unavailable");
    expect(html).toContain('value="deleted-or-foreign" disabled="" selected=""');
  });
});
