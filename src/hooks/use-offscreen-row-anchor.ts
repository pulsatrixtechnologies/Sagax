// Transcript rows skip their layout and paint while far from the viewport
// (`content-visibility: auto`, the `transcript-row` class in styles.css) and
// hold an estimated height until first drawn. The scroller turns the
// browser's scroll anchoring off (overflow-anchor: none) because the
// transcript does its own for prepends, so when a row above the viewport is
// drawn for the first time and its real height replaces the estimate, the
// rows being read would move. This holds them still: a row that changes
// height while entirely above the viewport moves scrollTop by the change.
// While the reader follows the bottom, bottom-follow already pins the end,
// so nothing is done.
import { useEffect, type RefObject } from "react";

export const TRANSCRIPT_ROW_SELECTOR = ".transcript-row";

/** Pure: the scrollTop change for rows that resized above the viewport. */
export function offscreenAnchorShift(
  changes: ReadonlyArray<{ top: number; previousHeight: number; height: number }>,
  scrollTop: number,
): number {
  let shift = 0;
  for (const change of changes) {
    // the row's bottom, as it was laid out before the change
    if (change.top + change.previousHeight <= scrollTop) shift += change.height - change.previousHeight;
  }
  return shift;
}

export function useOffscreenRowAnchor(
  scrollRef: RefObject<HTMLElement | null>,
  transcriptRef: RefObject<HTMLElement | null>,
  followRef: RefObject<boolean>,
  key: string | null,
) {
  useEffect(() => {
    const scroller = scrollRef.current;
    const transcript = transcriptRef.current;
    if (!key || !scroller || !transcript || typeof ResizeObserver === "undefined") return;
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      const changes: Array<{ top: number; previousHeight: number; height: number }> = [];
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const previousHeight = heights.get(entry.target);
        heights.set(entry.target, height);
        if (previousHeight === undefined || previousHeight === height) continue;
        // the row's top in the scroller's content, which its own change does not move
        changes.push({ top: entry.target.getBoundingClientRect().top - origin, previousHeight, height });
      }
      if (!changes.length || followRef.current) return;
      const shift = offscreenAnchorShift(changes, scroller.scrollTop);
      if (shift) scroller.scrollTop += shift;
    });
    const watch = (node: Node) => {
      if (node instanceof Element && node.matches(TRANSCRIPT_ROW_SELECTOR)) resize.observe(node);
    };
    transcript.querySelectorAll(TRANSCRIPT_ROW_SELECTOR).forEach(watch);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(watch);
        record.removedNodes.forEach((node) => { if (node instanceof Element) resize.unobserve(node); });
      }
    });
    mutations.observe(transcript, { childList: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [scrollRef, transcriptRef, followRef, key]);
}
