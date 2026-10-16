// Cmd+[ (Ctrl+[ elsewhere): back one page in a panel that opens pages in its
// own window (Connect apps, Browse Bots), as in a browser or Finder. Escape
// does the same, then closes; this one never closes. Cmd+Shift+[ stays the
// previous bot (src/App.tsx).
import { isMacPlatform } from "./keyboard-shortcuts";

export function isBackShortcut(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac: boolean = isMacPlatform()): boolean {
  if (event.shiftKey || event.altKey) return false;
  if (!(mac ? event.metaKey : event.ctrlKey)) return false;
  return event.key === "[" || event.code === "BracketLeft";
}

export function shortcutBackLabel(mac: boolean = isMacPlatform()): string {
  return mac ? "Esc, ⌘[" : "Esc, Ctrl+[";
}

/** What Escape or Cmd+[ does in a window with pages: the open page's own
 * step first (Browse Bots' detail, a tool, View all), then back one page;
 * Escape on the first page closes, Cmd+[ there does nothing. */
export type PageKeyAction = "inner" | "back" | "close" | null;

export function pageKeyAction(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  where: { depth: number; innerBack?: () => boolean },
  mac: boolean = isMacPlatform(),
): PageKeyAction {
  const back = isBackShortcut(event, mac);
  if (event.key !== "Escape" && !back) return null;
  if (where.innerBack?.()) return "inner";
  if (where.depth > 0) return "back";
  return back ? null : "close";
}
