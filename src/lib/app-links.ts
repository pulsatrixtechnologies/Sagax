// The handful of outward links the app offers from the profile menu and the
// About dialog. They are collected here so "where does Help go?" has one
// answer rather than one per call site.
export const APP_NAME = "Sagax";
/** The full brand, sibling of Pulsatrix Perspicax: the About dialog. */
export const APP_FULL_NAME = "Pulsatrix Sagax";
export const APP_REPOSITORY = "https://github.com/pulsatrixtechnologies/sagax";
/** Help, docs, releases, and the license all open this fork. */
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
/** No upstream Pro offer: the original project's site is never linked. */
export const PRO_URL = "";
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;

/** Fork version Vite inlined from package.json forkVersion. "dev" outside the bundler. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

/** Official OpenMausBot (upstream) release this fork is based on. Stays on that line. */
export function baseVersion(): string {
  return typeof __BASE_VERSION__ === "string" ? __BASE_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** "macOS", "Windows", "Linux" — or nothing at all in the browser, where the
 * host OS is not ours to claim. */
export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

/** Hands a link to the default browser through the preload bridge, falling
 * back to a new tab when the app runs in a plain browser. */
export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
