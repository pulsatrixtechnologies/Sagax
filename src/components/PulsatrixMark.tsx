// The Pulsatrix owl-face mark (outlined face, blue eyes, heartbeat line), the
// files Perspicax's console used before its C3 icon (pulsatrix-v3
// console/src/assets/pulsatrix-mark.png and pulsatrix-logo-light.png), drawn
// as plain images in their own colours: white strokes on dark rails, dark
// strokes on light ones.
//
// Which ground the sidebar is depends on the skin: the navy and dark rails
// take the dark file, the light rails the light one. Both images are in the
// markup and the skin tokens --sidebar-mark-on-dark / --sidebar-mark-on-light
// show exactly one of them, so the mark follows a skin change without any
// script. `ground` pins one file for a surface whose ground never changes
// (the Hibou 98 title bar is always navy).
import { cn } from "@/lib/cn";

export const MARK_ON_DARK = "/pulsatrix-owl-mark-dark.png";
export const MARK_ON_LIGHT = "/pulsatrix-owl-mark-light.png";
/** the mark is wider than tall (489 x 381) */
const ASPECT = 381 / 489;

export function PulsatrixMark({
  size = 22,
  className,
  ground,
}: {
  size?: number;
  className?: string;
  /** pin the dark-ground or light-ground file instead of following the skin */
  ground?: "dark" | "light";
}) {
  const img = (src: string, which: "dark" | "light", followSkin: boolean) => (
    <img
      src={src}
      alt=""
      width={size}
      height={Math.round(size * ASPECT)}
      draggable={false}
      data-pulsatrix-mark={which}
      className={cn("shrink-0 object-contain", followSkin && `pulsatrix-mark-on-${which}`, className)}
      style={{ width: size, height: Math.round(size * ASPECT) }}
    />
  );
  if (ground) return img(ground === "dark" ? MARK_ON_DARK : MARK_ON_LIGHT, ground, false);
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      {img(MARK_ON_DARK, "dark", true)}
      {img(MARK_ON_LIGHT, "light", true)}
    </span>
  );
}
