/**
 * The bot colors: every name a bot's `color` may carry, its value, and the
 * palette (tab) the avatar popover shows it under. Pure data, shared by the
 * server's validators, the wire type and the app (src/lib/mascot.ts).
 *
 * The first fifteen names are the original palette and keep their values, so
 * every stored bot looks the same; each one sits in a palette (vivid or
 * neutral). The palettes after them were designed together: same lightness
 * and chroma within a palette, so any two bots side by side look like a set.
 * Every color keeps the eyes readable: the shapes pick dark or light eyes by
 * contrast (eyeInkOn), the owl's eye sits in its own dark socket.
 */

/** The palettes, in the popover's tab order. */
export const MASCOT_COLOR_GROUPS = ["vivid", "pastel", "deep", "neon", "neutral"] as const;
export type MascotColorGroup = (typeof MASCOT_COLOR_GROUPS)[number];

/** Each palette's colors, in the swatch row's order, with their values. */
export const MASCOT_COLOR_PALETTES = {
  vivid: {
    red: "#D94B52",
    coral: "#E5634E",
    orange: "#E78531",
    amber: "#F2A51A",
    yellow: "#D8A729",
    green: "#009957",
    teal: "#01A492",
    cyan: "#0EA5C6",
    blue: "#377FE6",
    purple: "#8057C8",
    pink: "#D84F8B",
  },
  pastel: {
    blush: "#F3A5B6",
    peach: "#F6B897",
    butter: "#F1D88B",
    pistachio: "#C5DE98",
    mint: "#98DDB9",
    aqua: "#92DCD8",
    sky: "#9CC8F2",
    periwinkle: "#AEB4F1",
    lavender: "#C3AAEE",
    lilac: "#DDA9E3",
  },
  deep: {
    wine: "#7A1F3A",
    rust: "#8E3A1E",
    olive: "#5F5E1F",
    forest: "#1E5B3B",
    petrol: "#0F5560",
    navy: "#1E3A70",
    midnight: "#1B2448",
    indigo: "#3A2F8F",
    plum: "#5B2A6A",
    berry: "#7B1F5E",
  },
  neon: {
    scarlet: "#FF2D55",
    blaze: "#FF6A13",
    citrus: "#FFE81F",
    lime: "#B6FF2E",
    volt: "#2BFF88",
    laser: "#1FE5FF",
    electric: "#2F6BFF",
    ultraviolet: "#8A3BFF",
    magenta: "#F13BEB",
    hotpink: "#FF3FA4",
  },
  neutral: {
    white: "#F4F4F4",
    silver: "#BFC5CD",
    grey: "#8E949E",
    graphite: "#4B4F58",
    black: "#1D1E22",
    sand: "#D9C4A1",
    taupe: "#8C7B6E",
    brown: "#8B5E3C",
    bronze: "#A86F38",
    copper: "#C2643A",
    brass: "#C7A13D",
  },
} as const satisfies Record<MascotColorGroup, Record<string, `#${string}`>>;

/** The original fifteen, in their historical order (new bots still rotate through the first ten). */
const ORIGINAL = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "white", "black", "brown", "amber", "grey"] as const;

type PaletteColor<G extends MascotColorGroup> = keyof (typeof MASCOT_COLOR_PALETTES)[G];
export type MascotColorName = { [G in MascotColorGroup]: PaletteColor<G> }[MascotColorGroup] & string;

const added = MASCOT_COLOR_GROUPS.flatMap((group) => Object.keys(MASCOT_COLOR_PALETTES[group])).filter((name) => !(ORIGINAL as readonly string[]).includes(name));

/** Every color name: the original fifteen first, then the newer palettes. */
export const MASCOT_COLOR_NAMES = [...ORIGINAL, ...added] as unknown as readonly [MascotColorName, ...MascotColorName[]];

/** Every color's value. */
export const MASCOT_COLOR_HEX: Readonly<Record<MascotColorName, string>> = Object.freeze(
  Object.assign({}, ...MASCOT_COLOR_GROUPS.map((group) => MASCOT_COLOR_PALETTES[group])) as Record<MascotColorName, string>,
);

/** The palette a color belongs to; an unknown name or a raw hex reads as vivid. */
export function mascotColorGroup(color: string | null | undefined): MascotColorGroup {
  if (!color) return "vivid";
  return MASCOT_COLOR_GROUPS.find((group) => Object.hasOwn(MASCOT_COLOR_PALETTES[group], color)) ?? "vivid";
}

/** A palette's color names, in the swatch row's order. */
export function mascotColorsIn(group: MascotColorGroup): MascotColorName[] {
  return Object.keys(MASCOT_COLOR_PALETTES[group]) as MascotColorName[];
}

/* ------------------------------------------------------------- contrast */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb color. */
export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return 0;
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The dark and the light ink a mascot's eyes can wear. */
export const EYE_INK = { dark: "#1b1f27", light: "#f6f1e8" } as const;

/** The eye ink that reads best on a body color. */
export function eyeInkOn(fill: string): string {
  return contrastRatio(fill, EYE_INK.dark) >= contrastRatio(fill, EYE_INK.light) ? EYE_INK.dark : EYE_INK.light;
}
