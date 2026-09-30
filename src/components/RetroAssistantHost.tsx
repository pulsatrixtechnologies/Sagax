// Always mounted, nearly free: listens for the Konami code and mounts the
// retro owl assistant (fetched on first use) while the Hibou 98 easter egg is
// on. With the egg off it renders nothing and holds one keydown listener.
import { lazy, Suspense, useEffect, useState } from "react";
import { activeLocale } from "@/lib/i18n";
import { createKonamiDetector, KONAMI_SEQUENCE, loadRetroAssistant, onRetroToggle, readRetroEnabled, toggleRetro } from "@/lib/retro98";

const RetroAssistant = lazy(loadRetroAssistant);

type Phase = "off" | "on" | "leaving";

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function RetroAssistantHost() {
  const [phase, setPhase] = useState<Phase>(() => (readRetroEnabled() ? "on" : "off"));
  const [fresh, setFresh] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const detect = createKonamiDetector();
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const matched = detect(event.key);
      // The last two keys of the code are letters: inside a text field, keep
      // them out of the draft once the arrows have already matched.
      if (matched >= KONAMI_SEQUENCE.length - 1 && isEditable(event.target)) event.preventDefault();
      if (matched === KONAMI_SEQUENCE.length) toggleRetro();
    };
    window.addEventListener("keydown", onKey, true);
    const stop = onRetroToggle((on) => {
      setFresh(on);
      if (on) setGeneration((value) => value + 1);
      setPhase((current) => (on ? "on" : current === "off" ? "off" : "leaving"));
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      stop();
    };
  }, []);

  if (phase === "off") return null;
  return (
    <Suspense fallback={null}>
      <RetroAssistant
        key={generation}
        locale={activeLocale()}
        leaving={phase === "leaving"}
        fresh={fresh}
        onGone={() => setPhase((current) => (current === "leaving" ? "off" : current))}
      />
    </Suspense>
  );
}
