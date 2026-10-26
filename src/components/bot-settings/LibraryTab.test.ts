// Library tab: files and artifacts in one list, pinned ones on top, the rest
// grouped by period, one line per item (icon and name), no search, no filter,
// no Files | Artifacts switch.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ArtifactList } from "@/lib/artifacts";
import type { ThreadFile } from "@/lib/chat-files";
import type { ArtifactSummary } from "../../../shared/artifacts";

const { LibraryBody } = await import("./LibraryTab");
const { artifactStatus, intervalLabel } = await import("../artifacts/ArtifactsSection");

const now = Date.parse("2026-10-26T12:00:00Z");
const DAY = 24 * 3_600_000;
const artifact = (id: string, title: string, favorite: boolean, extra: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id, botId: "bot1", title, favorite, popped: false, createdAt: now - 3_600_000, updatedAt: now - 120_000, rev: 1,
  refresh: { state: "idle", failures: 0 }, ...extra,
});
const file = (id: string, name: string, daysAgo: number, extra: Partial<ThreadFile> = {}): ThreadFile => ({
  id: id.repeat(24).slice(0, 24), messageId: "m1", source: "written", path: name, name, at: now - daysAgo * DAY, size: 12, available: true, ...extra,
});
const list = (artifacts: ArtifactSummary[] | null, error = false): ArtifactList => ({ artifacts, error, reload: () => {}, patch: () => {} });
const render = (files: ThreadFile[] | null, artifacts: ArtifactList, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LibraryBody, { threadId: "t1", files, list: artifacts, now, ...extra }));

beforeEach(() => setLocale("en"));

describe("Library tab", () => {
  const files = [file("a", "plan.md", 1), file("b", "export.zip", 3, { mime: "application/zip" }), file("c", "notes.md", 12)];
  const artifacts = [artifact("art_0000001", "Dispatch email preview in French", false, { updatedAt: now - 20 * DAY })];

  it("shows files and artifacts together, grouped by period, each group in a rounded card", () => {
    const html = render(files, list(artifacts));
    const thisWeek = html.indexOf('data-library-group="thisWeek"');
    const older = html.indexOf('data-library-group="older"');
    expect(thisWeek).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(thisWeek);
    expect(html).toContain("This week");
    expect(html).toContain("Older");
    expect(html).toContain("rounded-2xl");
    const week = html.slice(thisWeek, older);
    expect(week).toContain("plan.md");
    expect(week).toContain("export.zip");
    expect(week).not.toContain("notes.md");
    const old = html.slice(older);
    expect(old).toContain("notes.md");
    expect(old).toContain("Dispatch email preview in French");
    expect(old).toContain("data-artifact-row=");
    expect(html).not.toContain('data-library-group="pinned"');
  });

  it("has no search bar, no Filter button and no Files | Artifacts switch", () => {
    const html = render(files, list(artifacts));
    expect(html).not.toContain("Search files");
    expect(html).not.toContain("Filter");
    expect(html).not.toContain("data-library-choice");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('type="search"');
  });

  it("puts pinned files and pinned artifacts under Pinned on top, once", () => {
    const html = render(
      [file("a", "plan.md", 1), file("c", "notes.md", 30, { pinned: true })],
      list([artifact("art_0000001", "Preview", true, { updatedAt: now - 40 * DAY })]),
    );
    const pinned = html.indexOf('data-library-group="pinned"');
    expect(pinned).toBeGreaterThan(-1);
    expect(pinned).toBeLessThan(html.indexOf('data-library-group="thisWeek"'));
    const section = html.slice(pinned, html.indexOf('data-library-group="thisWeek"'));
    expect(section).toContain("Pinned");
    expect(section).toContain("notes.md");
    expect(section).toContain("Preview");
    expect(section).not.toContain("plan.md");
    // not listed a second time below
    expect(html.slice(html.indexOf('data-library-group="thisWeek"'))).not.toContain("notes.md");
    expect(html).not.toContain('data-library-group="older"');
    expect(section).toContain('data-library-pin="on"');
    expect(html.slice(html.indexOf('data-library-group="thisWeek"'))).toContain('data-library-pin="off"');
  });

  it("offers Pin or Unpin on a file's row and in its menu", () => {
    const html = render([file("a", "plan.md", 1), file("b", "x.md", 2, { pinned: true })], list([]), { openMenus: true });
    expect(html).toContain('aria-label="Pin"');
    expect(html).toContain('aria-label="Unpin"');
    expect(html).toContain('role="menuitem"');
  });

  it("an artifact's row pins through the same control and its menu keeps open, pop out and delete", () => {
    const html = render([], list([artifact("art_0000001", "CPU", false)]), { openMenus: true });
    expect(html).toContain('data-library-pin="off"');
    expect(html).toContain("Pop out");
    expect(html).toContain("Delete");
  });

  it("keeps a short empty message", () => {
    const html = render([], list([]));
    expect(html).toContain("data-library-empty");
    expect(html).toContain("Files and artifacts from this chat show up here.");
    expect(html).not.toContain("data-library-group");
  });

  it("shows loading, then a retry on error", () => {
    expect(render(null, list(null))).toContain("Loading");
    const html = render(null, list(null, true), { filesError: true });
    expect(html).toContain("Couldn&#x27;t load this library.");
  });

  it("speaks French: Épinglés, Cette semaine, Plus ancien", () => {
    setLocale("fr");
    const html = render([file("a", "plan.md", 1), file("c", "old.md", 30), file("d", "pin.md", 30, { pinned: true })], list([]));
    expect(html).toContain("Épinglés");
    expect(html).toContain("Cette semaine");
    expect(html).toContain("Plus ancien");
    expect(html).toContain('aria-label="Épingler"');
    expect(html).toContain('aria-label="Désépingler"');
  });
});

describe("an artifact's refresh state on its row", () => {
  const source = { kind: "tool" as const, tool: "workspace_read", args: { path: "stats.json" } };

  it("says how fresh it is and how often it refreshes", () => {
    const fresh = artifact("art_ok00001", "Tickets", false, { source, intervalSeconds: 300, dataAt: now - 60_000, refresh: { state: "ok", failures: 0 } });
    expect(artifactStatus(fresh, now)).toEqual({ tone: "muted", text: "Updated 1 min ago · every 5 min" });
    expect(intervalLabel(30)).toBe("30 s");
    expect(intervalLabel(7200)).toBe("2 h");
    expect(intervalLabel(86_400)).toBe("1 d");
    const html = render([], list([fresh]));
    // a healthy artifact is just its icon and name; only a problem gets a mark
    expect(html).not.toContain("data-artifact-status");
  });

  it("explains a blocked source, a pause and a failed run, with the server's words in the tooltip", () => {
    const blocked = artifact("art_bl00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "blocked", failures: 0, error: "This tool needs your approval each time." } });
    expect(artifactStatus(blocked, now)).toMatchObject({ tone: "warning", text: expect.stringContaining("needs your approval"), detail: "This tool needs your approval each time." });
    const paused = artifact("art_pa00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 3, error: "down" } });
    expect(artifactStatus(paused, now)).toMatchObject({ tone: "danger", text: "Refresh paused after 3 failures. Refresh now, or ask the bot." });
    const byBot = artifact("art_pb00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 0 } });
    expect(artifactStatus(byBot, now).text).toBe("Refresh paused by the bot.");
    const failed = artifact("art_er00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "error", failures: 1, lastRunAt: now - 120_000, error: "no such file" } });
    expect(artifactStatus(failed, now)).toMatchObject({ tone: "warning", text: "Refresh failed 2 min ago; it tries again.", detail: "no such file" });
    const html = render([], list([blocked]));
    expect(html).toContain('data-artifact-status="blocked"');
    expect(html).toContain("This tool needs your approval each time.");
  });

  it("an artifact with no source just says when it changed, in French too", () => {
    setLocale("fr");
    expect(artifactStatus(artifact("art_st00001", "Note", false), now).text).toContain("Mis à jour");
    const paused = artifact("art_pa00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 3 } });
    expect(artifactStatus(paused, now).text).toBe("Rafraîchissement en pause après 3 échecs. Rafraîchissez maintenant ou demandez au bot.");
  });
});
