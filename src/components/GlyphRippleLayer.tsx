// The conversation's glyph field (Settings > Appearance > "Glyph ripple on
// click", off by default). One canvas behind the transcript, never in the
// way of a click (pointer-events none, aria-hidden); the drawing and the
// listeners live in src/lib/glyph-ripple.ts, outside React, so a ring never
// re-renders anything. Desktop only: a coarse pointer (a phone or a tablet
// browser) gets nothing; the iOS app is native and has no such setting yet.
import { useEffect, useRef, type RefObject } from "react";
import { mountGlyphField } from "@/lib/glyph-ripple";
import { useGlyphRipple } from "@/lib/glyph-ripple-preferences";

/** A fine pointer (mouse, trackpad, pen): the desktop app and a desktop
 * browser. Read once; it does not change while the window lives. */
export function hasFinePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches;
}

/** Whether the conversation shows the field: the switch, on a desktop. */
export function useGlyphRippleShown(): boolean {
  const enabled = useGlyphRipple();
  return enabled && hasFinePointer();
}

/** The canvas itself, for a pane that is `position: relative`. `paneRef` is
 * the transcript's scroller: clicks there start a ring; the composer and the
 * menus are outside it. */
export function GlyphRippleCanvas({ paneRef }: { paneRef: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const pane = paneRef.current;
    if (!canvas || !pane) return;
    const { unmount } = mountGlyphField(canvas, pane);
    return unmount;
  }, [paneRef]);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-glyph-ripple=""
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
      // read back as resolved colours by readGlyphColors; no border is drawn
      style={{ color: "var(--color-ink)", borderColor: "var(--glyph-ripple-tint, var(--color-accent))" }}
    />
  );
}

/** The field when the person turned it on, else nothing (no canvas, no
 * listener, no cost). */
export function GlyphRippleLayer({ paneRef, shown }: { paneRef: RefObject<HTMLElement | null>; shown: boolean }) {
  if (!shown) return null;
  return <GlyphRippleCanvas paneRef={paneRef} />;
}
