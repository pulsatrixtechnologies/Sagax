// Files tab: the Files and Artifacts views, and favorite artifacts in their
// own section on top whichever view is up.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { ArtifactList } from "@/lib/artifacts";
import type { Bot } from "@/state/store";
import type { ArtifactSummary } from "../../../shared/artifacts";

vi.mock("./FilesSection", () => ({ FilesSection: () => createElement("div", { "data-files-marker": "" }) }));
const { LibraryBody } = await import("./LibraryTab");
const { artifactStatus, intervalLabel } = await import("../artifacts/ArtifactsSection");

const now = Date.parse("2026-10-16T12:00:00Z");
const artifact = (id: string, title: string, favorite: boolean, extra: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id, botId: "pepper", title, favorite, popped: false, createdAt: now - 3_600_000, updatedAt: now - 120_000, rev: 1,
  refresh: { state: "idle", failures: 0 }, ...extra,
});
const list = (artifacts: ArtifactSummary[] | null, error = false): ArtifactList => ({ artifacts, error, reload: () => {}, patch: () => {} });
const bot = { id: "pepper", name: "Pepper", threadId: "t1", messages: [] } as unknown as Bot;
const render = (artifacts: ArtifactList, initialView: "files" | "artifacts" = "artifacts") =>
  renderToStaticMarkup(createElement(LibraryBody, { bot, list: artifacts, initialView, now }));

beforeEach(() => setLocale("en"));

describe("Files tab > Artifacts", () => {
  it("offers Files and Artifacts, with the artifact count", () => {
    const html = render(list([artifact("art_a000001", "CPU", false)]), "files");
    expect(html).toContain('data-library-choice="files"');
    expect(html).toContain('data-library-choice="artifacts"');
    expect(html).toContain("data-files-marker");
    expect(html).toMatch(/Artifacts<span[^>]*>1<\/span>/);
  });

  it("puts favorites in their own section on top, in both views", () => {
    const artifacts = list([artifact("art_fav0001", "Open tickets", true), artifact("art_oth0001", "CPU", false)]);
    for (const view of ["files", "artifacts"] as const) {
      const html = render(artifacts, view);
      const favorites = html.indexOf("data-artifact-favorites");
      expect(favorites).toBeGreaterThan(-1);
      expect(favorites).toBeLessThan(html.indexOf("data-library-choice"));
      expect(html).toContain("Favorites");
      const section = html.slice(favorites, html.indexOf("data-library-choice"));
      expect(section).toContain("Open tickets");
      expect(section).not.toContain("CPU");
    }
  });

  it("lists every artifact in the Artifacts view, with its star and its last update", () => {
    const html = render(list([artifact("art_fav0001", "Open tickets", true), artifact("art_oth0001", "CPU", false)]));
    const all = html.slice(html.indexOf('data-artifacts-list="all"'));
    expect(all).toContain('data-artifact-row="art_fav0001"');
    expect(all).toContain('data-artifact-row="art_oth0001"');
    expect(all).toContain('aria-pressed="true"');
    expect(all).toContain('aria-label="Remove from favorites"');
    expect(all).toContain('aria-label="Add to favorites"');
    expect(all).toContain("Updated 2 min ago");
  });

  it("has no favorites section without favorites, and tells the person to ask the bot when empty", () => {
    const html = render(list([]));
    expect(html).not.toContain("data-artifact-favorites");
    expect(html).toContain("data-artifacts-empty");
    expect(html).toContain("Ask this bot to save a widget as an artifact");
  });

  it("shows loading, then a retry on error, in French too", () => {
    expect(render(list(null))).toContain("Loading artifacts");
    setLocale("fr");
    const html = render(list(null, true));
    expect(html).toContain("Impossible de charger les artefacts.");
    expect(html).toContain("Artefacts");
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
    const html = render(list([fresh]));
    expect(html).toContain('data-artifact-status="ok"');
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
    const html = render(list([blocked]));
    expect(html).toContain('title="This tool needs your approval each time."');
  });

  it("an artifact with no source just says when it changed, in French too", () => {
    setLocale("fr");
    expect(artifactStatus(artifact("art_st00001", "Note", false), now).text).toContain("Mis à jour");
    const paused = artifact("art_pa00001", "CPU", false, { source, intervalSeconds: 60, refresh: { state: "paused", failures: 3 } });
    expect(artifactStatus(paused, now).text).toBe("Rafraîchissement en pause après 3 échecs. Rafraîchissez maintenant ou demandez au bot.");
  });
});
