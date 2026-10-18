// The background effects behind the conversation (Settings > Appearance >
// Background effects). One registry: each effect has an id, a renderer kind
// (the glyph field of #716, or a full-screen WebGL2 shader), the colour
// palettes it offers (the first is its default) and its i18n keys
// (`settings.backgroundEffects.effect.<id>.name` / `.description`).
// Nothing here draws; src/lib/background-engine.ts and the glyph field do.

export const BACKGROUND_EFFECT_IDS = [
  "none",
  "glyphs",
  "matrix",
  "starfield",
  "aurora",
  "magnetic",
  "synthwave",
  "ink",
  "bubbles",
  "constellation",
  "sonar",
  "fireflies",
  "crystal",
] as const;
export type BackgroundEffectId = (typeof BACKGROUND_EFFECT_IDS)[number];

export const PALETTE_IDS = ["theme", "aurora", "ocean", "ember", "neon", "violet", "gold", "mono"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const INTENSITIES = ["low", "medium", "high"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const DEFAULT_INTENSITY: Intensity = "medium";

/** Brightness multiplier of an intensity. Medium is the reference look, low
 * stays out of the way, high is for a person who wants the show. */
export const INTENSITY_GAIN: Record<Intensity, number> = { low: 0.6, medium: 1, high: 1.45 };

export type EffectKind = "none" | "glyphs" | "shader";

export interface BackgroundEffect {
  id: BackgroundEffectId;
  kind: EffectKind;
  /** The palettes offered, the first one is the default. Empty for "none". */
  palettes: readonly PaletteId[];
}

export const BACKGROUND_EFFECTS: readonly BackgroundEffect[] = [
  { id: "none", kind: "none", palettes: [] },
  { id: "glyphs", kind: "glyphs", palettes: ["theme", "aurora", "ocean", "ember", "neon", "violet", "gold", "mono"] },
  { id: "matrix", kind: "shader", palettes: ["aurora", "theme", "ocean", "ember", "neon", "mono"] },
  { id: "starfield", kind: "shader", palettes: ["ocean", "theme", "violet", "gold", "ember", "mono"] },
  { id: "aurora", kind: "shader", palettes: ["aurora", "violet", "ocean", "ember", "neon", "theme"] },
  { id: "magnetic", kind: "shader", palettes: ["theme", "ocean", "ember", "neon", "gold", "mono"] },
  { id: "synthwave", kind: "shader", palettes: ["neon", "violet", "ocean", "ember", "aurora", "theme"] },
  { id: "ink", kind: "shader", palettes: ["violet", "ocean", "ember", "aurora", "theme", "mono"] },
  { id: "bubbles", kind: "shader", palettes: ["ocean", "neon", "violet", "aurora", "theme", "gold"] },
  { id: "constellation", kind: "shader", palettes: ["theme", "ocean", "gold", "violet", "aurora", "mono"] },
  { id: "sonar", kind: "shader", palettes: ["aurora", "ocean", "ember", "theme", "neon", "mono"] },
  { id: "fireflies", kind: "shader", palettes: ["gold", "aurora", "ember", "ocean", "violet", "theme"] },
  { id: "crystal", kind: "shader", palettes: ["ocean", "violet", "aurora", "gold", "theme", "mono"] },
];

export function isBackgroundEffectId(value: unknown): value is BackgroundEffectId {
  return typeof value === "string" && (BACKGROUND_EFFECT_IDS as readonly string[]).includes(value);
}

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && (PALETTE_IDS as readonly string[]).includes(value);
}

export function isIntensity(value: unknown): value is Intensity {
  return typeof value === "string" && (INTENSITIES as readonly string[]).includes(value);
}

export function backgroundEffect(id: BackgroundEffectId): BackgroundEffect {
  return BACKGROUND_EFFECTS.find((effect) => effect.id === id) ?? BACKGROUND_EFFECTS[0];
}

/** The palette an effect shows: the chosen one when the effect offers it,
 * else the effect's default. */
export function effectPalette(id: BackgroundEffectId, chosen: PaletteId | undefined): PaletteId {
  const effect = backgroundEffect(id);
  if (chosen && effect.palettes.includes(chosen)) return chosen;
  return effect.palettes[0] ?? "theme";
}

// ------------------------------------------------------------- palettes ---

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Three colours per scheme: a (the body), b (the second voice), c (the hot
 * highlight). Light skins get deeper inks so a faint effect still reads on a
 * bright ground; "theme" and "mono" are computed from the skin. */
export interface PaletteColors {
  a: RGB;
  b: RGB;
  c: RGB;
}

const hex = (value: string): RGB => {
  const n = Number.parseInt(value.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

type Fixed = Exclude<PaletteId, "theme" | "mono">;

export const FIXED_PALETTES: Record<Fixed, { dark: [string, string, string]; light: [string, string, string] }> = {
  aurora: { dark: ["#3dffa8", "#2fd5ff", "#c3a2ff"], light: ["#0b9e62", "#0a7fa8", "#7a3fd1"] },
  ocean: { dark: ["#3d8bff", "#35e0ff", "#d2f6ff"], light: ["#1f5fd1", "#0a8fb0", "#0b3d8c"] },
  ember: { dark: ["#ff8a3d", "#ff3d5a", "#ffe0a3"], light: ["#d4570b", "#c21f3a", "#8a4a00"] },
  neon: { dark: ["#ff3dcb", "#35e8ff", "#fff06b"], light: ["#c2189a", "#0a8fb0", "#7a6200"] },
  violet: { dark: ["#a06bff", "#ff6bd5", "#ebdcff"], light: ["#6a3fd1", "#b0228a", "#3d1f8c"] },
  gold: { dark: ["#ffc54d", "#ff9a3d", "#fff3cf"], light: ["#a87400", "#b0570b", "#5c3e00"] },
};

/** A swatch for the picker (CSS colours, the light or dark variant). */
export function paletteSwatch(id: PaletteId, scheme: "light" | "dark"): [string, string, string] | null {
  if (id === "theme" || id === "mono") return null;
  return FIXED_PALETTES[id][scheme];
}

function rgbToHsl({ r, g, b }: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3) };
}

/** The tint turned by `turns` of the colour wheel (keeps its saturation and
 * lightness), for the second voice of the "theme" palette. */
export function hueShift(color: RGB, turns: number): RGB {
  const [h, s, l] = rgbToHsl(color);
  return hslToRgb((((h + turns) % 1) + 1) % 1, s, l);
}

const toward = (color: RGB, target: number, k: number): RGB => ({
  r: color.r + (target - color.r) * k,
  g: color.g + (target - color.g) * k,
  b: color.b + (target - color.b) * k,
});

/** The three colours of a palette for a scheme. `theme` is the skin: its ink
 * and its tint (`--glyph-ripple-tint`, the accent or a blue on Midnight). */
export function resolvePalette(id: PaletteId, scheme: "light" | "dark", theme: { ink: RGB; tint: RGB }): PaletteColors {
  if (id === "theme") {
    const hot = scheme === "dark" ? toward(theme.tint, 1, 0.45) : toward(theme.tint, 0, 0.3);
    return { a: theme.tint, b: hueShift(theme.tint, 0.09), c: hot };
  }
  if (id === "mono") {
    const soft = scheme === "dark" ? toward(theme.ink, 0, 0.35) : toward(theme.ink, 1, 0.3);
    return { a: theme.ink, b: soft, c: theme.ink };
  }
  const [a, b, c] = FIXED_PALETTES[id][scheme];
  return { a: hex(a), b: hex(b), c: hex(c) };
}

export const rgbCss = ({ r, g, b }: RGB) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
