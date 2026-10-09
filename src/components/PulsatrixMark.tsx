// The Pulsatrix owl-face mark (outlined face, blue eyes, heartbeat line), the
// files Perspicax's console used before its C3 icon (pulsatrix-v3
// console/src/assets/pulsatrix-mark.png and pulsatrix-logo-light.png), drawn
// as plain images in their own colours: white strokes on dark rails, dark
// strokes on light ones.
//
// Which ground the sidebar is depends on the skin: the navy and dark rails
// take the white owl, the light rails the navy one. Both owls are in the
// markup and the skin tokens --sidebar-mark-on-dark / --sidebar-mark-on-light
// show exactly one of them, so the mark follows a skin change without any
// script. `ground` pins one colour for a surface whose ground never changes
// (the Hibou 98 title bar is always navy).
import { cn } from "@/lib/cn";
import { PulsatrixOwlMark } from "./PulsatrixOwlMark";

/** the official vector owl is 28 x 25 (public/brand/pulsatrix-owl-mark-color.svg) */
const ASPECT = 25 / 28;
const WHITE = "#FFFFFF";
const NAVY = "#03153C";

export function PulsatrixMark({
  size = 22,
  className,
  ground,
}: {
  size?: number;
  className?: string;
  /** pin the dark-ground or light-ground colour instead of following the skin */
  ground?: "dark" | "light";
}) {
  const mark = (which: "dark" | "light", followSkin: boolean) => (
    <span
      aria-hidden="true"
      data-pulsatrix-mark={which}
      className={cn("shrink-0", followSkin && `pulsatrix-mark-on-${which}`, className)}
      style={{ color: which === "dark" ? WHITE : NAVY, lineHeight: 0 }}
    >
      <PulsatrixOwlMark width={size} height={Math.round(size * ASPECT)} />
    </span>
  );
  if (ground) return mark(ground, false);
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {mark("dark", true)}
      {mark("light", true)}
    </span>
  );
}
