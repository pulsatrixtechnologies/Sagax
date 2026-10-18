// The glyph field behind the conversation (Settings > Appearance >
// Background effects > Glyph ripple). One canvas behind the transcript,
// never in the way of a click (pointer-events none, aria-hidden); the drawing
// and the listeners live in src/lib/glyph-energy.ts (the WebGL energy weave)
// and src/lib/glyph-ripple.ts (the 2D ring when WebGL2 is missing), outside
// React, so a wave never re-renders anything. Desktop only: a coarse
// pointer (a phone or a tablet browser) gets nothing; the iOS app is native
// and has no such setting yet. BackgroundEffectLayer.tsx picks the effect.
import { useEffect, useRef, type RefObject } from "react";
import { mountGlyphEnergy } from "@/lib/glyph-energy";

/** A fine pointer (mouse, trackpad, pen): the desktop app and a desktop
 * browser. Read once; it does not change while the window lives. */
export function hasFinePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches;
}

/** The canvas itself, for a pane that is `position: relative`. `paneRef` is
 * the transcript's scroller: clicks there start a ring; the composer and the
 * menus are outside it. `tint` is the lit colour (the skin's by default),
 * `gain` the intensity. */
export function GlyphRippleCanvas({ paneRef, tint, gain = 1 }: { paneRef: RefObject<HTMLElement | null>; tint?: string; gain?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const pane = paneRef.current;
    if (!canvas || !pane) return;
    const { unmount } = mountGlyphEnergy(canvas, pane);
    return unmount;
  }, [paneRef]);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-glyph-ripple=""
      data-gain={String(gain)}
      className="pointer-events-none absolute inset-0 block h-full w-full select-none"
      // read back as resolved colours by readGlyphColors; no border is drawn
      style={{ color: "var(--color-ink)", borderColor: tint ?? "var(--glyph-ripple-tint, var(--color-accent))" }}
    />
  );
}
