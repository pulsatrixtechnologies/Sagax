// Hibou 98 extras for a floating bot, fetched only while that skin is worn:
// the retro balloon stylesheet (the same one Trombi wears) and Trombi's
// sparkle, played each time a reply settles.
import "../retro-assistant/retro-assistant.css";
import { useEffect, useRef, useState } from "react";
import { Puff } from "../retro-assistant/RetroArt";

export default function RetroDecor({ sparkle, reduced }: { sparkle: number; reduced: boolean }) {
  const first = useRef(sparkle);
  const [burst, setBurst] = useState<number | null>(null);
  useEffect(() => {
    // the value on mount is history, not a reply that just settled
    if (sparkle === first.current || reduced) return;
    first.current = sparkle;
    setBurst(sparkle);
    const done = setTimeout(() => setBurst(null), 800);
    return () => clearTimeout(done);
  }, [sparkle, reduced]);
  if (burst === null) return null;
  return (
    <span key={burst} className="fb-sparkle" aria-hidden="true">
      <Puff />
    </span>
  );
}
