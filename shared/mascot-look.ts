/**
 * A bot's character: which mascot stands for it everywhere (the avatar in
 * the sidebar, the chat, the panels, the desktop mascot), and that
 * character's own look. Stored with the bot (BotRecord.mascotLook), so every
 * device, the web and the phone see the same one.
 *
 * - owl: the Sagax owl; its color is the bot's color and its skin the bot's
 *   mascotSkin (shared/mascot-skins.ts). `style` picks the flat owl (2d,
 *   the default) or the 3D preview, on the desktop.
 * - shape: one of the shapes (a body with two small eyes), in the
 *   bot's color, with a shape skin.
 * - trombi: the Hibou 98 paperclip, with a Trombi skin.
 *
 * Each character keeps its own skin, so switching character and back finds
 * the choice made before. Absent means the owl, as every bot had before.
 */
import { z } from "zod";

export const MASCOT_CHARACTERS = ["owl", "shape", "trombi"] as const;
export type MascotCharacter = (typeof MASCOT_CHARACTERS)[number];

/** The shapes, in the picker's order (the owner's reference grid, read left to right). */
export const MASCOT_SHAPES = ["circle", "cloud", "squircle", "sparkle", "clover", "bean", "flower", "drop", "pill", "pick", "house", "star", "hexagon"] as const;
export type MascotShape = (typeof MASCOT_SHAPES)[number];

/** Shapes from the first set, renamed or replaced: a stored look keeps working. */
export const LEGACY_SHAPES: Readonly<Record<string, MascotShape>> = { blob: "bean", triangle: "pick" };

/**
 * Skins for the shapes; every one renders on every shape. The first four are
 * the everyday finishes; the rest are premium editions with their own idle
 * effect, equip animation and move effects (src/components/skin-fx).
 */
export const SHAPE_SKINS = ["plain", "pastel", "glossy", "night", "outline", "gold", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"] as const;
export type ShapeSkin = (typeof SHAPE_SKINS)[number];

/** Skins for Trombi. */
export const TROMBI_SKINS = ["classic", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type TrombiSkin = (typeof TROMBI_SKINS)[number];

/** How rare a skin is: the picker's label and card. */
export type SkinTier = "common" | "rare" | "epic" | "legendary";

export const SHAPE_SKIN_TIER: Readonly<Record<ShapeSkin, SkinTier>> = {
  plain: "common",
  pastel: "common",
  glossy: "common",
  night: "common",
  outline: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  crystal: "epic",
  circuit: "epic",
  holo: "legendary",
  molten: "legendary",
  galaxy: "legendary",
};

export const TROMBI_SKIN_TIER: Readonly<Record<TrombiSkin, SkinTier>> = {
  classic: "common",
  retro98: "common",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

/**
 * Other names a stored skin may carry (drafts of the premium set, older
 * builds): a stored look keeps working and is saved back under the current id.
 */
export const LEGACY_SHAPE_SKINS: Readonly<Record<string, ShapeSkin>> = {
  ink: "outline",
  royal: "gold",
  metal: "chrome",
  "liquid-metal": "chrome",
  glass: "crystal",
  cyber: "circuit",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
  nebula: "galaxy",
};
export const LEGACY_TROMBI_SKINS: Readonly<Record<string, TrombiSkin>> = {
  retro: "retro98",
  win98: "retro98",
  royal: "gold",
  metal: "chrome",
  cyber: "glitch",
  iridescent: "holo",
  holographic: "holo",
  lava: "molten",
};

const legacy = (table: Readonly<Record<string, string>>) => (value: unknown) => (typeof value === "string" && Object.hasOwn(table, value) ? table[value] : value);

export const mascotLookSchema = z
  .object({
    character: z.enum(MASCOT_CHARACTERS),
    style: z.enum(["2d", "3d"]).optional(),
    shape: z.preprocess((value) => (typeof value === "string" && value in LEGACY_SHAPES ? LEGACY_SHAPES[value] : value), z.enum(MASCOT_SHAPES)).optional(),
    skins: z
      .object({
        shape: z.preprocess(legacy(LEGACY_SHAPE_SKINS), z.enum(SHAPE_SKINS)).optional(),
        trombi: z.preprocess(legacy(LEGACY_TROMBI_SKINS), z.enum(TROMBI_SKINS)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MascotLook = z.infer<typeof mascotLookSchema>;

export const DEFAULT_MASCOT_LOOK: MascotLook = Object.freeze({ character: "owl" }) as MascotLook;

/**
 * A stored or received look, or the owl when absent or malformed. A skin this
 * build does not know (a newer build's) is dropped, never the whole look: the
 * character keeps its default skin instead of turning back into the owl.
 */
export function botMascotLook(value: unknown): MascotLook {
  const parsed = mascotLookSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (!value || typeof value !== "object" || !("skins" in value)) return DEFAULT_MASCOT_LOOK;
  const { skins, ...rest } = value as { skins?: unknown };
  const known: Record<string, string> = {};
  if (skins && typeof skins === "object") {
    const { shape, trombi } = skins as { shape?: unknown; trombi?: unknown };
    const shapeSkin = legacy(LEGACY_SHAPE_SKINS)(shape);
    const trombiSkin = legacy(LEGACY_TROMBI_SKINS)(trombi);
    if ((SHAPE_SKINS as readonly unknown[]).includes(shapeSkin)) known.shape = shapeSkin as string;
    if ((TROMBI_SKINS as readonly unknown[]).includes(trombiSkin)) known.trombi = trombiSkin as string;
  }
  return mascotLookSchema.safeParse(Object.keys(known).length ? { ...rest, skins: known } : rest).data ?? DEFAULT_MASCOT_LOOK;
}

/** The look with every choice filled in. */
export function completeMascotLook(value: unknown): Required<Omit<MascotLook, "skins">> & { skins: { shape: ShapeSkin; trombi: TrombiSkin } } {
  const look = botMascotLook(value);
  return {
    character: look.character,
    style: look.style ?? "2d",
    shape: look.shape ?? "circle",
    skins: { shape: look.skins?.shape ?? "plain", trombi: look.skins?.trombi ?? "classic" },
  };
}

/** What a character offers in the avatar popover. */
export const CHARACTER_PAINT: Readonly<Record<MascotCharacter, { colors: boolean; skins: readonly string[]; wingMoves: boolean }>> = {
  owl: { colors: true, skins: [], wingMoves: true },
  shape: { colors: true, skins: SHAPE_SKINS, wingMoves: false },
  trombi: { colors: false, skins: TROMBI_SKINS, wingMoves: false },
};
