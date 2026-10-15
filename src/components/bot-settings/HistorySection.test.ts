import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";
import type { HistoryRow } from "./HistorySection";
import { HistorySection } from "./HistorySection";
import { setLocale } from "@/lib/i18n";

const bot: Bot = {
  id: "bot-1",
  threadId: "thread-1",
  name: "Scout",
  title: "Scout",
  description: "",
  notifications: false,
  color: "green",
  unread: false,
  modelSelection: { instanceId: "local", model: "test-model" },
  messages: [],
};

// newest first, as the server sends them: v3 renames, v2 changes the
// Personality and the label together, v1 names the bot
const v3: HistoryRow = { id: "r4", at: 3000, actor: "bot", via: "api", field: "name", summary: "", before: "Ada", after: "Aria" };
const v2soul: HistoryRow = { id: "r2", at: 2000, actor: "user", via: "ui", field: "soul", summary: "", before: "Be brief.\nCite sources.", after: "Be thorough.\nCite sources.", canRestore: true };
const v2title: HistoryRow = { id: "r3", at: 2000, actor: "user", via: "ui", field: "title", summary: "", before: "", after: "Research" };
const v1: HistoryRow = { id: "r1", at: 1000, actor: "user", via: "ui", field: "name", summary: "", before: "Bot", after: "Ada" };
const rows = [v3, v2title, v2soul, v1];

function render(list: HistoryRow[] | null, props: Partial<Parameters<typeof HistorySection>[0]> = {}) {
  return renderToStaticMarkup(createElement(HistorySection, { bot, rows: list, onRestore: vi.fn(), ...props }));
}
const versionIds = (html: string) => [...html.matchAll(/data-history-version="([\w-]+)"/g)].map((m) => m[1]);

describe("HistorySection: the bot's versions", () => {
  it("shows Loading… before rows arrive, and the empty state", () => {
    expect(render(null)).toContain("Loading…");
    expect(render([])).toContain("No changes recorded yet.");
  });

  it("lists one version per save, newest first, with who and what changed", () => {
    const html = render(rows);
    expect(versionIds(html)).toEqual(["r4", "r2", "r1"]);
    expect(html).toContain("The bot · Changed: Name");
    expect(html).toContain("You · Changed: Personality, Label");
    expect(html).toContain('title="api"');
    // the newest is the current version, and offers no restore
    expect(html.match(/data-history-current/g)?.length).toBe(1);
    expect(html.indexOf("data-history-current")).toBeLessThan(html.indexOf('data-history-version="r2"'));
  });

  it("compares an opened version with the current one: a line diff of the Personality, then and now for the rest", () => {
    const html = render(rows, { defaultOpen: "r1" });
    expect(html).toContain('data-history-compare="r1"');
    expect(html).toContain('data-history-diff="soul"');
    expect(html).toContain('data-history-diff="name"');
    expect(html).toContain('data-history-diff="title"');
    expect(html).toMatch(/data-diff="removed"[^>]*>- Be brief\./);
    expect(html).toMatch(/data-diff="added"[^>]*>\+ Be thorough\./);
    expect(html).toMatch(/data-diff="same"[^>]*> {2}Cite sources\./);
    expect(html).toContain(">Ada</dd>");
    expect(html).toContain(">Aria</dd>");
    expect(html).toContain("(empty)");
  });

  it("offers Restore this version on an older version, and asks with what comes back", () => {
    const onRestore = vi.fn();
    const html = render(rows, { defaultOpen: "r2", onRestore });
    expect(html).toContain('data-history-restore="r2"');
    expect(html).toContain("Restore this version");
    expect(html).not.toMatch(/data-history-restore="r2"[^>]*disabled=""/);
    // the current version has nothing to restore
    expect(render(rows, { defaultOpen: "r4" })).not.toContain("data-history-restore");
    expect(render(rows, { defaultOpen: "r4" })).toContain("Nothing has changed since this version.");
  });

  it("disables restore while one runs, and names what the history cannot give back", () => {
    expect(render(rows, { defaultOpen: "r2", restoring: true })).toMatch(/data-history-restore="r2"[^>]*disabled=""/);
    const redacted = [v3, { ...v2soul, canRestore: false }, v2title, v1];
    const html = render(redacted, { defaultOpen: "r1" });
    expect(html).toContain("Left as it is (the history keeps no exact copy): Personality");
  });

  it("marks a version that is itself a restore", () => {
    const restore: HistoryRow = { id: "r5", at: 4000, actor: "user", via: "restore", field: "name", summary: "", before: "Aria", after: "Ada" };
    expect(render([restore, ...rows])).toContain("Version restored");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = render(rows, { defaultOpen: "r2" });
    expect(html).toContain("Version actuelle");
    expect(html).toContain("Revenir à cette version");
    expect(html).toContain("Modifié : Personnalité, Libellé");
    setLocale("en");
  });
});
