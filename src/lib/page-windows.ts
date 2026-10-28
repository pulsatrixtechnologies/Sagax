// A page in a window of its own (2026-10-28): from the Library, Settings >
// Published pages and the open page's « Open in a window ». The desktop app
// opens one system window per page through the artifact window bridge
// (electron/artifact-window.mjs), keyed `page:<pageId>`, so it keeps its place
// and can go on another screen; asking again brings it forward. In a browser
// it is a new tab on the same address. There is no window drawn inside Sagax.
// The window shows the same surface as the open page (PageSurface: ×, title,
// Share, « ⋯ »), so both ways share the same drawing and actions.
import { artifactWindowPath, PAGE_WINDOW_PREFIX } from "@/components/artifacts/artifact-windows";

const ID = /^[A-Za-z0-9_-]{8,40}$/;

export function pageWindowId(pageId: string): string {
  return `${PAGE_WINDOW_PREFIX}${pageId}`;
}

/** The page id a window id names, or null. Pure. */
export function pageIdOfWindow(id: string): string | null {
  if (!id.startsWith(PAGE_WINDOW_PREFIX)) return null;
  const pageId = id.slice(PAGE_WINDOW_PREFIX.length);
  return ID.test(pageId) ? pageId : null;
}

/** Open a page in its own window, or bring that window forward. Resolves
 * false when nothing could be opened. */
export async function openPageInOwnWindow(page: { id: string; botId: string; title: string }): Promise<boolean> {
  if (!ID.test(page.id)) return false;
  const desktop = typeof window !== "undefined" ? window.ogb?.artifactWindow : undefined;
  if (desktop) {
    const result = await desktop.open({ botId: page.botId, artifactId: pageWindowId(page.id), title: page.title }).catch(() => "refused" as const);
    return result !== "refused";
  }
  if (typeof window === "undefined" || typeof window.open !== "function") return false;
  window.open(artifactWindowPath(page.botId, pageWindowId(page.id)), "_blank", "noopener");
  return true;
}
