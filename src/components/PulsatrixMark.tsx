// The Perspicax mark (the owl bust over a panel bar), the exact files that sit
// beside "Perspicax" in its console sidebar (console/src/assets/
// perspicax-mark-{dark,light}.svg), drawn as plain images in their own
// colours. The panel bar is the lifted blue on the dark-ground file and navy
// on the light-ground one, so each reads on its own ground.
//
// Which ground the sidebar is depends on the skin: the navy and dark rails
// take the dark file, the light rails the light one. Both images are in the
// markup and the skin tokens --sidebar-mark-on-dark / --sidebar-mark-on-light
// show exactly one of them, so the mark follows a skin change without any
// script. `ground` pins one file for a surface whose ground never changes
// (the Hibou 98 title bar is always navy).
import { cn } from "@/lib/cn";

export const MARK_ON_DARK = "/perspicax-mark-dark.svg";
export const MARK_ON_LIGHT = "/perspicax-mark-light.svg";

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
      height={size}
      draggable={false}
      data-pulsatrix-mark={which}
      className={cn("shrink-0 object-contain", followSkin && `pulsatrix-mark-on-${which}`, className)}
      style={{ width: size, height: size }}
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
