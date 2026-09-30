// Always mounted, nearly free: tells whether the Hibou 98 skin is worn and,
// only then, fetches the late-90s window chrome (title bar, menu bar,
// toolbar, status bar). Under every other skin it renders nothing, so the
// app stays pixel-identical and the chunk is never downloaded.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { RETRO_SKIN } from "@/lib/retro98";

const RetroTop = lazy(() => import("./retro98/RetroChrome").then((module) => ({ default: module.RetroTop })));
const RetroBoot = lazy(() => import("./retro98/RetroBoot"));
const RetroStatus = lazy(() => import("./retro98/RetroChrome").then((module) => ({ default: module.RetroStatusBar })));

function wearingRetro(): boolean {
  // Tests stub a bare `document`; only a real element carries the skin.
  return typeof document !== "undefined" && document.documentElement?.dataset?.skin === RETRO_SKIN;
}

/** True while the document wears the retro98 skin (the picker or the easter egg). */
export function useRetroSkin(): boolean {
  const [on, setOn] = useState(wearingRetro);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setOn(wearingRetro()));
    if (!document.documentElement) return;
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    setOn(wearingRetro());
    return () => observer.disconnect();
  }, []);
  return on;
}

export function RetroChromeSlot({ slot, onNewBot }: { slot: "top" | "status"; onNewBot?: () => void }) {
  const on = useRetroSkin();
  if (!on) return null;
  return <Suspense fallback={null}>{slot === "top" ? <RetroTop onNewBot={onNewBot} /> : <RetroStatus />}</Suspense>;
}

/**
 * Hibou 98's special effect: a short CRT power-on each time the skin is put
 * on while the app is open (the picker or the secret code), not on a cold
 * start that already wears it. The effect's chunk loads only then.
 */
export function RetroBootSlot() {
  const on = useRetroSkin();
  const was = useRef(on);
  const [boot, setBoot] = useState(0);
  useEffect(() => {
    if (on && !was.current) setBoot((value) => value + 1);
    was.current = on;
  }, [on]);
  const done = useCallback(() => setBoot(0), []);
  if (!boot) return null;
  return (
    <Suspense fallback={null}>
      <RetroBoot key={boot} onDone={done} />
    </Suspense>
  );
}
