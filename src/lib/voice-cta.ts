// The composer's round call to action (Voice, or Send once something is
// typed) wears the open bot's color, like Grok Bot's tinted prompt button: a
// full fill with a white glyph. The bot color is the mascot's own
// (shared/mascot-colors.ts), so the button changes with the bot on screen.
//
// A bot color is any of ~70 swatches, many of them light (pastels, neon), and
// a skin cannot see it, so the skin contrast check never measures it. The
// rule lives here instead: the fill is darkened toward black until the white
// glyph reaches 3:1 (WCAG 1.4.11, a graphic that carries the meaning). A
// colorless bot (white, grey, black...) keeps the default ink button, as
// Grok Bot does for its grey bots.
import { contrastRatio, MASCOT_COLOR_HEX } from "../../shared/mascot-colors";

export interface BotCtaColors {
  /** The button's fill, #rrggbb. */
  fill: string;
  /** The fill under the pointer: a step darker. */
  hover: string;
  /** The glyph: always white. */
  ink: "#ffffff";
}

/** The glyph's minimum contrast on the fill (WCAG 1.4.11). */
export const CTA_MIN_CONTRAST = 3;

const HEX = /^#[0-9a-f]{6}$/i;

function parse(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** `hex` mixed toward black by `t` (0..1). */
export function darken(hex: string, t: number): string {
  const [r, g, b] = parse(hex);
  return toHex([r * (1 - t), g * (1 - t), b * (1 - t)]);
}

/** True for a color without a hue of its own (white, greys, black, cream). */
export function isColorless(hex: string): boolean {
  const [r, g, b] = parse(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255 < 0.12;
}

/** The CTA colors for a bot color (a swatch name or #rrggbb); null keeps the default button. */
export function botCtaColors(color: string | null | undefined): BotCtaColors | null {
  if (!color) return null;
  const hex = Object.hasOwn(MASCOT_COLOR_HEX, color)
    ? MASCOT_COLOR_HEX[color as keyof typeof MASCOT_COLOR_HEX]
    : HEX.test(color) ? color : null;
  if (!hex || isColorless(hex)) return null;
  let fill = hex.toLowerCase();
  for (let step = 1; contrastRatio("#ffffff", fill) < CTA_MIN_CONTRAST && step <= 20; step++) {
    fill = darken(hex, step * 0.04);
  }
  return { fill, hover: darken(fill, 0.1), ink: "#ffffff" };
}

/** The CTA's custom properties: the fill and its hover, read by CTA_TONED. */
export function ctaStyle(tone: BotCtaColors | null | undefined): Record<string, string> | undefined {
  return tone ? { "--cta-fill": tone.fill, "--cta-hover": tone.hover } : undefined;
}

/** A CTA in the bot's color (ctaStyle sets the values). */
export const CTA_TONED = "bg-[var(--cta-fill)] text-white hover:bg-[var(--cta-hover)]";
/** The default CTA: the skin's ink, as Grok Bot's grey bots. */
export const CTA_DEFAULT = "bg-ink text-app hover:brightness-110";
/** Grok Bot's prompt circles: 28 px, round, glyph cross-fades. */
export const CTA_CIRCLE = "relative flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
