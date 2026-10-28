// Download PDF (2026-10-28): the browser prints the wrapper, whose print
// style shows only the page's frame at its whole height. The frame tells its
// height (shared/published-pages.ts PAGE_SIZE_MESSAGE); this keeps it as
// --sagax-print-height on the wrapper's root, so the browser's own Print
// (Ctrl+P) gets the whole page too, and Save as PDF writes it.
import { PAGE_SIZE_ASK, parseSizeMessage } from "../../shared/published-pages";

/** The print height for a size the frame posted: its whole height, never
 * less than its window. Pure. */
export function printHeight(size: { h: number; vh: number }): number {
  return Math.max(size.h, size.vh);
}

/** Keep the frame's whole height for printing: only messages from the
 * page's own frame, only numbers. */
export function watchPageSize(frame: HTMLIFrameElement | null, root: HTMLElement = document.documentElement): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const size = parseSizeMessage(event.data);
    if (size) root.style.setProperty("--sagax-print-height", `${printHeight(size)}px`);
  };
  window.addEventListener("message", onMessage);
  // the page may have loaded before this script started: ask once more,
  // and again whenever the frame loads
  const ask = () => frame?.contentWindow?.postMessage({ type: PAGE_SIZE_ASK, v: 1 }, "*");
  ask();
  frame?.addEventListener("load", ask);
  return () => {
    window.removeEventListener("message", onMessage);
    frame?.removeEventListener("load", ask);
  };
}

/** The browser's print dialog, where Save as PDF writes the file named
 * after the page's title (the wrapper's own title). */
export function downloadPdf(): void {
  window.print();
}
