// Always mounted (App): draws the open floating windows, bottom to top, over
// the app and under its modals (z-40; modals are z-50). Renders nothing while
// none is open. A restored window waits, undrawn, for its kind's renderer.
import { useEffect } from "react";

import { floatingWindows, useFloatingWindows } from "@/lib/floating-windows";
import { FloatingWindow } from "./FloatingWindow";

export function FloatingWindowsHost() {
  const { windows } = useFloatingWindows();
  const manager = floatingWindows();
  // a smaller window keeps every floating window reachable
  useEffect(() => {
    if (windows.length === 0) return;
    const onResize = () => {
      for (const entry of manager.snapshot().windows) manager.setRect(entry.id, entry.rect);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [manager, windows.length]);

  const shown = windows.filter((entry) => manager.hasRenderer(entry));
  if (shown.length === 0) return null;
  const top = shown[shown.length - 1]?.id;
  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-floating-windows="">
      {shown.map((entry) => (
        <FloatingWindow key={entry.id} entry={entry} manager={manager} focused={entry.id === top}>
          {manager.renderBody(entry)}
        </FloatingWindow>
      ))}
    </div>
  );
}
