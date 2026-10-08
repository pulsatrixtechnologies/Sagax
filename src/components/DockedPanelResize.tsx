// The right-hand docked panel (bot settings, person) is one resizable column
// for the whole app: one drag handle on its left edge, one width (320 to 720
// px) stored under one key, so a person opens at the width the bot panel was
// left at. Both panels use this hook and handle instead of their own copy.
import { useRef, useState } from "react";

export const DOCKED_PANEL_WIDTH_KEY = "omb-settings-panel-width";
export const DOCKED_PANEL_MIN_WIDTH = 320;
export const DOCKED_PANEL_MAX_WIDTH = 720;
export const DOCKED_PANEL_DEFAULT_WIDTH = 360;
const KEY_STEP = 24;

export function readDockedPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(DOCKED_PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= DOCKED_PANEL_MIN_WIDTH && stored <= DOCKED_PANEL_MAX_WIDTH) return stored;
  } catch { /* default width */ }
  return DOCKED_PANEL_DEFAULT_WIDTH;
}

const clampWidth = (width: number) => Math.min(DOCKED_PANEL_MAX_WIDTH, Math.max(DOCKED_PANEL_MIN_WIDTH, width));
const storeWidth = (width: number) => {
  try { localStorage.setItem(DOCKED_PANEL_WIDTH_KEY, String(width)); } catch { /* session only */ }
};

export function useDockedPanelWidth() {
  const [width, setWidth] = useState(readDockedPanelWidth);
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  return { width, setWidth, drag };
}

export function DockedPanelResizeHandle({ label, panel }: { label: string; panel: ReturnType<typeof useDockedPanelWidth> }) {
  const { width, setWidth, drag } = panel;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={DOCKED_PANEL_MIN_WIDTH}
      aria-valuemax={DOCKED_PANEL_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width, current: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        const next = clampWidth(from.width + (from.x - event.clientX));
        drag.current = { ...from, current: next };
        setWidth(next);
      }}
      onPointerUp={(event) => {
        const finished = drag.current?.current;
        if (finished == null) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        storeWidth(finished);
      }}
      onKeyDown={(event) => {
        const delta = event.key === "ArrowLeft" ? KEY_STEP : event.key === "ArrowRight" ? -KEY_STEP : 0;
        if (!delta) return;
        event.preventDefault();
        setWidth((current) => {
          const next = clampWidth(current + delta);
          storeWidth(next);
          return next;
        });
      }}
      className="app-resize-handle -left-[3px] hidden lg:block"
    />
  );
}
