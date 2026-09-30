// The Pulsatrix mark (the owl bust over a panel bar), the same mark that sits
// beside "Perspicax" in its console. public/pulsatrix-mark.svg is its
// one-ink master; it is drawn here as a mask filled with currentColor, so the
// mark takes the text colour of wherever it sits and reads on every skin.
import { cn } from "@/lib/cn";

const MASK = "url(/pulsatrix-mark.svg) center / contain no-repeat";

export function PulsatrixMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-pulsatrix-mark
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ width: size, height: size, mask: MASK, WebkitMask: MASK }}
    />
  );
}
