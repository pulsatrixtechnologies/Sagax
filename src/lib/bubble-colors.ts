// The colours of the conversation bubbles (2026-10-28). The person's own
// message is a bubble filled with the accent, so the skin, colour, duo-tone or
// mood they chose shows in the thread; a bot's reply (and another person's
// message in a room) is a quiet grey bubble, a little off the page.
//
//   - the text on the accent bubble is white, and reaches 4.5:1 (WCAG 1.4.3,
//     normal text). When the accent cannot carry it, its lightness moves (the
//     hue stays) to the nearest one that does; an accent too pale to carry
//     white without a large shift takes dark text instead, at the same 4.5:1;
//   - the grey is neutral in every skin, lighter than a dark page and darker
//     than a light one, and the page's own text reads on it.
//
// Pure: the stylesheet generator (scripts/gen-bubble-tokens.mjs), the brand
// accent (brand.ts) and the tests call it; nothing here touches the DOM.
import { contrastHex, fromHsl, parseHex, toHex, toHsl, type Scheme } from "./switch-colors.ts";

export interface BubbleColors {
  /** The person's own bubble: the accent at a lightness that carries its text. */
  user: string;
  /** The text on that bubble. */
  userInk: string;
  /** The bot's bubble: a neutral grey. */
  bot: string;
}

/** WCAG 1.4.3, normal text. */
export const BUBBLE_MIN_CONTRAST = 4.5;
/** What the derivation aims at, a little over the minimum so rounding a
 * channel to 8 bits never drops a pair below it. */
const TARGET = 4.6;
const LIGHT_INK = "#ffffff";
const DARK_INK = "#111111";
/** How far (in HSL lightness) an accent may move to carry white before dark text is used. */
const MAX_SHIFT = 0.28;

type Rgb = [number, number, number];

function round(c: Rgb): Rgb {
  return c.map((v) => Math.round(Math.min(255, Math.max(0, v)))) as Rgb;
}

/** The lightness of the accent's hue nearest to its own where `ink` reaches the target, else null. */
function fit(accent: Rgb, ink: string): { rgb: Rgb; shift: number } | null {
  if (contrastHex(toHex(accent), ink) >= TARGET) return { rgb: accent, shift: 0 };
  const [h, s, l0] = toHsl(accent);
  let best: { rgb: Rgb; shift: number } | null = null;
  for (let i = 0; i <= 400; i++) {
    const l = i / 400;
    const rgb = round(fromHsl(h, s, l));
    if (contrastHex(toHex(rgb), ink) < TARGET) continue;
    const shift = Math.abs(l - l0);
    if (!best || shift < best.shift) best = { rgb, shift };
  }
  return best;
}

/** The person's bubble and its text, for an accent (`#rrggbb`). */
export function userBubble(accent: string): { user: string; userInk: string } {
  const rgb = parseHex(accent) ?? [128, 128, 128];
  const light = fit(rgb, LIGHT_INK);
  const dark = fit(rgb, DARK_INK);
  const useLight = light && (light.shift <= MAX_SHIFT || !dark || light.shift <= dark.shift);
  const pick = useLight ? light : dark;
  return useLight
    ? { user: toHex(pick?.rgb ?? rgb), userInk: LIGHT_INK }
    : { user: toHex(pick?.rgb ?? rgb), userInk: DARK_INK };
}

/** The bot's grey: the page's lightness, neutral, a step lighter (dark) or darker (light). */
export function botBubble(app: string, scheme: Scheme): string {
  const rgb = parseHex(app) ?? (scheme === "dark" ? [18, 18, 18] : [255, 255, 255]);
  const l = toHsl(rgb)[2];
  const next = scheme === "dark" ? Math.min(1, l + 0.075) : Math.max(0, l - 0.065);
  return toHex(round(fromHsl(0, 0, next)));
}

/**
 * The bubbles' colours for an accent on a skin.
 *
 * @param accent the accent (`#rrggbb`); the person's bubble keeps its hue
 * @param app    the page colour the bot's grey is cut from
 */
export function bubbleColors({ accent, app, scheme }: { accent: string; app: string; scheme: Scheme }): BubbleColors {
  return { ...userBubble(accent), bot: botBubble(app, scheme) };
}

/** The custom properties a bubble reads, from its colours. */
export function bubbleVars(colors: BubbleColors): Record<string, string> {
  return {
    "--color-bubble-user": colors.user,
    "--color-bubble-user-ink": colors.userInk,
    "--color-bubble-bot": colors.bot,
  };
}

/** The names of the brand's bubble properties, set or removed together. */
export const BRAND_BUBBLE_VARS = ["--brand-bubble-user", "--brand-bubble-user-ink"] as const;

/**
 * A deployment's brand accent (brand.ts) replaces the skin's accent at run
 * time, so its bubble cannot come from the generated blocks. It does not
 * depend on the scheme (the accent alone decides it), and the generated
 * blocks read it first: `var(--brand-bubble-user, <skin's>)`.
 */
export function brandBubbleVars(accent: string | undefined): Record<string, string> {
  if (!accent || !parseHex(accent)) return {};
  const { user, userInk } = userBubble(accent);
  return { "--brand-bubble-user": user, "--brand-bubble-user-ink": userInk };
}
