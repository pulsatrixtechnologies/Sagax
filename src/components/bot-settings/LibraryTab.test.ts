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
