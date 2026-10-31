// Open an http(s) or mailto URL a sandboxed widget or page frame asked for
// (#1799). The frame has no allow-popups; it posts the URL, and the parent
// uses the same open-external path as an artifact Open button.
import { parsePageOpenMessage } from "../../shared/published-pages";
import { openExternalLink } from "./app-links";
import { parseWidgetOpenMessage } from "./rich-blocks";

/** When `event` is a WIDGET_OPEN_MESSAGE from `source`, open it and return
 * the URL; otherwise null. */
export function acceptWidgetOpen(event: MessageEvent, source: Window | null | undefined): string | null {
  if (!source || event.source !== source) return null;
  const url = parseWidgetOpenMessage(event.data);
  if (!url) return null;
  void openExternalLink(url).catch(() => undefined);
  return url;
}

/** A page frame (or its wrapper) posted PAGE_OPEN_MESSAGE to the app window.
 * Source is not pinned: the URL is re-validated here. */
export function acceptPageOpen(event: MessageEvent): string | null {
  const url = parsePageOpenMessage(event.data);
  if (!url) return null;
  void openExternalLink(url).catch(() => undefined);
  return url;
}
