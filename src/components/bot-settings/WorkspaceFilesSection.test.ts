// Files: the whole workspace with when each file reaches the bot, sizes
// against budgets, dates, last use and the forgotten marker; document
// actions only on docs/; Simple mode keeps the badges, not their details.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { WorkspaceEntry, WorkspaceListing } from "@/lib/workspace-files";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ advanced: true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));

const { WorkspaceFilesSection, entryDetails } = await import("./WorkspaceFilesSection");

const now = Date.parse("2026-10-09T12:00:00Z");
const day = 24 * 60 * 60_000;
const file = (path: string, load: WorkspaceEntry["load"], extra: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  path, kind: "file", bytes: 120, createdAt: now - 2 * day, modifiedAt: now - day, load, editable: true, markdown: true, forgotten: false, ...extra,
});
const listing: WorkspaceListing = {
  workspacePath: "/data/workspaces/pepper",
  now,
  forgottenAfterDays: 30,
  budgets: { rules: { maxLines: 60, maxBytes: 8000 }, memory: { maxLines: 200, maxBytes: 24000 }, soul: { maxBytes: 24000 } },
  rulesTemplate: "# Rules\n",
  soul: { ...file("SOUL.md", "every-turn", { editable: false, virtual: "soul", budget: { maxBytes: 24000, lines: 0, bytes: 900, over: false } }), lastUsedAt: now - 60_000 },
  entries: [
    file("MEMORY.md", "every-turn", { budget: { maxLines: 200, maxBytes: 24000, lines: 12, bytes: 800, over: false }, lastUsedAt: now - 60_000 }),
    file("RULES.md", "every-turn", { budget: { maxLines: 60, maxBytes: 8000, lines: 4, bytes: 90, over: false } }),
    { path: "docs", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    file("docs/onboarding.md", "on-demand", { createdAt: now - 90 * day, modifiedAt: now - 90 * day, forgotten: true }),
    { path: "memory", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    file("memory/log/2026-10-08.md", "never"),
    file("report.pdf", "never", { editable: false, markdown: false }),
  ],
  truncated: false,
};
const bot = { id: "pepper", name: "Pepper" } as unknown as Bot;
const render = () => renderToStaticMarkup(createElement(WorkspaceFilesSection, { bot, active: false, onOpenSection: () => {}, initial: listing }))
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

beforeEach(() => {
  setLocale("en");
  fixture.advanced = true;
});

describe("WorkspaceFilesSection", () => {
  it("lists SOUL.md first, then the whole tree, each file with its load badge", () => {
    const html = render();
    const rows = [...html.matchAll(/data-file-row="([^"]+)"/g)].map((match) => match[1]);
    expect(rows).toEqual(["SOUL.md", "MEMORY.md", "RULES.md", "docs", "docs/onboarding.md", "memory", "memory/log/2026-10-08.md", "report.pdf"]);
    const badges = [...html.matchAll(/data-load-badge="([\w-]+)"/g)].map((match) => match[1]);
    expect(badges).toEqual(["every-turn", "every-turn", "every-turn", "on-demand", "never", "never"]);
    for (const label of [">Every turn<", ">On demand<", ">Never loaded<"]) expect(html).toContain(label);
  });

  it("marks a file nobody used in 30 days that does not load every turn as forgotten", () => {
    const html = render();
    expect(html).toMatch(/data-file-row="docs\/onboarding.md" data-forgotten=""/);
    expect(html.match(/data-forgotten-badge=""/g)).toHaveLength(1);
    expect(html).toContain("Not used in 30 days and not loaded every turn");
  });

  it("shows sizes against budgets, dates and last use in Advanced", () => {
    const html = render();
    expect(html).toContain("12 of 200 lines · 800 B of 23.4 KB");
    expect(html).toContain("4 of 60 lines · 90 B of 7.8 KB");
    expect(html).toContain("last used 1 min ago");
    expect(html).toContain("not used yet");
    expect(html).toContain("data-workspace-path");
    expect(entryDetails(listing.entries[3]!, now)).toContain("120 B · created");
  });

  it("keeps the badges and drops their details in Simple mode", () => {
    fixture.advanced = false;
    const html = render();
    expect(html).toContain(">Every turn<");
    expect(html).not.toContain("data-file-details");
    expect(html).not.toContain("data-workspace-path");
    expect(html).not.toContain('title="Loaded into the system prompt');
    expect(html).toContain("data-forgotten-badge");
  });

  it("offers rename and delete on documents only, and download on every real file", () => {
    const html = render();
    expect(html).toContain('aria-label="Rename onboarding.md"');
    expect(html).toContain('aria-label="Delete onboarding.md"');
    expect(html).not.toContain('aria-label="Rename MEMORY.md"');
    expect(html).not.toContain('aria-label="Delete RULES.md"');
    expect(html).toContain('aria-label="Download report.pdf"');
    expect(html).not.toContain('aria-label="Download SOUL.md"');
    expect(html).toContain("data-files-new");
    expect(html).toContain("data-files-upload");
    expect(html).toContain('accept=".md,.markdown,text/markdown"');
  });
});
