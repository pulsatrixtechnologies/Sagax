// docs/releases/*.md are compiled into the renderer so "What's new" works
// offline, including the first launch after an update with no network.
import { compareVersions, releaseNotesSection, type ReleaseNoteEntry } from "./release-notes";

const rawModules = import.meta.glob("../../docs/releases/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** Version (from the file name) to the whole markdown file. */
export function bundledReleaseCatalog(modules: Record<string, string> = rawModules): Record<string, string> {
  const catalog: Record<string, string> = {};
  for (const [path, body] of Object.entries(modules)) {
    const match = /(\d+\.\d+\.\d+)\.md(?:\?|$)/.exec(path);
    if (match && typeof body === "string") catalog[match[1]!] = body;
  }
  return catalog;
}

/** The current version's notes in the app language, or null when this build has no file. */
export function bundledNotesFor(
  version: string,
  language: string,
  catalog: Record<string, string> = bundledReleaseCatalog(),
): string | null {
  const body = catalog[version];
  if (!body) return null;
  const section = releaseNotesSection(body, language).trim();
  return section || null;
}

/** Every bundled version, newest first. */
export function bundledVersions(catalog: Record<string, string> = bundledReleaseCatalog()): string[] {
  return Object.keys(catalog).sort((a, b) => compareVersions(b, a));
}

/**
 * Bundled versions after `previous` up to and including `current`, newest
 * first, as whole files (the viewer picks the language). Empty when
 * `previous` is not older than `current`.
 */
export function bundledNotesSince(
  previous: string,
  current: string,
  catalog: Record<string, string> = bundledReleaseCatalog(),
): ReleaseNoteEntry[] {
  return bundledVersions(catalog)
    .filter((version) => compareVersions(version, previous) > 0 && compareVersions(version, current) <= 0)
    .map((version) => ({ version, note: catalog[version]! }));
}
