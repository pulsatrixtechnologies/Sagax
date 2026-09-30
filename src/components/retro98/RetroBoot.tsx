// Hibou 98: the skin's power-on. When the retro98 skin is put on, the app
// wakes like a late-90s CRT: a bright line opens into a glowing screen, a
// scanline sweeps down, and the startup chime plays when the assistant's
// sounds are on. Under 1.5 s, skipped entirely under reduced motion, and in
// a lazy chunk that only a device wearing the skin ever fetches.
import "./retro-boot.css";
import { useEffect } from "react";
import { createRetroSounds } from "@/components/retro-assistant/sounds";
import { readPrefs } from "@/components/retro-assistant/logic";

export const BOOT_MS = 1300;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export default function RetroBoot({ onDone }: { onDone: () => void }) {
  const reduced = prefersReducedMotion();
  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    // Put on from the picker or the secret code: a user gesture, so audio may start.
    const sounds = createRetroSounds(() => readPrefs().options.sounds);
    sounds.unlock();
    sounds.play("chime");
    const done = setTimeout(onDone, BOOT_MS);
    const quiet = setTimeout(() => sounds.close(), 1500);
    return () => {
      clearTimeout(done);
      clearTimeout(quiet);
    };
  }, [reduced, onDone]);
  if (reduced) return null;
  return (
    <div className="r98-boot" aria-hidden="true" data-testid="retro-boot">
      <span className="r98-boot-screen" />
      <span className="r98-boot-glow" />
      <span className="r98-boot-sweep" />
      <span className="r98-boot-lines" />
    </div>
  );
}
