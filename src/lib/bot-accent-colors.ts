// The pure half of "Use bot color as accent" (src/lib/bot-accent.ts): a
// bot colour turned into the accent variables for a skin whose panel is
// known, with no DOM and no React, so the server can draw a published
// page's bar in its person's accent too (src/lib/page-look.ts).
import { accentInk } from "./bubble-colors.ts";

export const BOT_ACCENT_VARS = ["--color-accent", "--color-accent-border", "--color-focus", "--color-accent-text", "--color-accent-ink"] as const;

const HEX = /^#([0-9a-f]{6})$/i;
const SHORT_HEX = /^#([0-9a-f]{3})$/i;

/** #rgb or #rrggbb (any case) as #rrggbb, else null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (HEX.test(text)) return text.toLowerCase();
  const short = SHORT_HEX.exec(text);
  if (short) return `#${[...short[1]!].map((c) => c + c).join("")}`.toLowerCase();
  return null;
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminanceOf(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` mixed toward black (a light surface) or white (a dark one) in
 * small steps until it holds `ratio` against `surface`. */
export function holdContrast(color: string, surface: string, ratio: number): string {
  if (contrast(color, surface) >= ratio) return color;
  const target: [number, number, number] = luminanceOf(surface) > 0.18 ? [0, 0, 0] : [255, 255, 255];
  const from = channels(color);
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    const mixed = toHex([0, 1, 2].map((i) => from[i]! + (target[i]! - from[i]!) * t) as [number, number, number]);
    if (contrast(mixed, surface) >= ratio) return mixed;
  }
  return toHex(target);
}

/** The text on `fill`: the accent button's ink (bubble-colors.ts,
 * accentInk), white or near black, black on a mid tone where near black
 * falls short of 4.5:1. The same rule as the brand's button and the
 * person's bubble, so the two always match. */
export function inkOn(fill: string): string {
  return accentInk(fill);
}

/** The accent variables for a bot colour on a skin whose panel is `surface`;
 * null (keep the skin's accent) when either is not a colour. */
export function botAccentVars(color: string | null | undefined, surface: string | null | undefined): Record<(typeof BOT_ACCENT_VARS)[number], string> | null {
  const hex = normalizeHex(color);
  const panel = normalizeHex(surface);
  if (!hex || !panel) return null;
  const fill = holdContrast(hex, panel, 3);
  const text = holdContrast(hex, panel, 4.5);
  return {
    "--color-accent": fill,
    "--color-accent-border": fill,
    "--color-focus": fill,
    "--color-accent-text": text,
    "--color-accent-ink": inkOn(fill),
  };
}
