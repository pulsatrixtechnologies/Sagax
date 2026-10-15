// electron-updater 6.8.9 reads each version's release notes from the GitHub
// releases.atom feed when fullChangelog is on, taking the version from the
// tag in the entry link with /\/tag\/v?([^/]+)$/. Sagax tags are
// pulsa-vX.Y.Z, so the version read is "pulsa-v0.5.4", which is not semver:
// computeReleaseNotes returned null and every update showed "No notes were
// published" (0.5.3 to 0.5.4). Accept one leading word prefix before the v.
// Exact, single-site replacement that fails closed on upstream changes.
export function patchReleaseNotesUpdater(source) {
  const before = "      const releaseVersionRegExp = /\\/tag\\/v?([^/]+)$/;";
  const after = "      const releaseVersionRegExp = /\\/tag\\/(?:[A-Za-z][A-Za-z0-9_]*-)?v?([^/]+)$/;";
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`Expected one release notes version pattern to patch, found ${count}`);
  return source.replace(before, after);
}
