// A quiet detail that appears once the pointer has rested on something for a
// while, and fades when it leaves. A mouse or a pen only: a touch screen has no
// resting pointer, and the app has no long-press pattern to borrow.
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

/** How long the pointer rests before the detail appears. */
export const HOVER_DWELL_MS = 1200;
/** How long the fade-out is given before the detail unmounts. */
export const HOVER_FADE_MS = 200;

export function useHoverDwell(enabled = true, dwellMs = HOVER_DWELL_MS) {
  const [shown, setShown] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (dwell.current) clearTimeout(dwell.current);
    if (fade.current) clearTimeout(fade.current);
    dwell.current = fade.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  const onPointerEnter = useCallback((event: PointerEvent) => {
    if (!enabled || event.pointerType === "touch") return;
    clear();
    dwell.current = setTimeout(() => {
      setMounted(true);
      setShown(true);
    }, dwellMs);
  }, [enabled, dwellMs, clear]);
  const onPointerLeave = useCallback(() => {
    clear();
    setShown(false);
    fade.current = setTimeout(() => setMounted(false), HOVER_FADE_MS);
  }, [clear]);
  return { shown, mounted, handlers: { onPointerEnter, onPointerLeave } };
}
