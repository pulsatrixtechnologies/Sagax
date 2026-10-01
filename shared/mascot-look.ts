/**
 * A bot's character: which mascot stands for it everywhere (the avatar in
 * the sidebar, the chat, the panels, the desktop mascot), and that
 * character's own look. Stored with the bot (BotRecord.mascotLook), so every
 * device, the web and the phone see the same one.
 *
 * - owl: the Sagax owl; its color is the bot's color and its skin the bot's
 *   mascotSkin (shared/mascot-skins.ts). `style` picks the flat owl (2d,
 *   the default) or the 3D preview, on the desktop.
 * - shape: one of the original shapes (a body with two small eyes), in the
 *   bot's color, with a shape skin.
 * - trombi: the Hibou 98 paperclip, with a Trombi skin.
 *
 * Each character keeps its own skin, so switching character and back finds
 * the choice made before. Absent means the owl, as every bot had before.
 */
import { z } from "zod";

export const MASCOT_CHARACTERS = ["owl", "shape", "trombi"] as const;
export type MascotCharacter = (typeof MASCOT_CHARACTERS)[number];

/** The original shapes, in the picker's order. */
export const MASCOT_SHAPES = ["circle", "blob", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"] as const;
export type MascotShape = (typeof MASCOT_SHAPES)[number];

/** Skins for the original shapes; every one renders on every shape. */
export const SHAPE_SKINS = ["plain", "glossy", "outline", "neon", "pastel", "night"] as const;
export type ShapeSkin = (typeof SHAPE_SKINS)[number];

/** Skins for Trombi. */
export const TROMBI_SKINS = ["classic", "gold", "neon", "retro98"] as const;
export type TrombiSkin = (typeof TROMBI_SKINS)[number];

export const mascotLookSchema = z
  .object({
    character: z.enum(MASCOT_CHARACTERS),
    style: z.enum(["2d", "3d"]).optional(),
    shape: z.enum(MASCOT_SHAPES).optional(),
    skins: z
      .object({
        shape: z.enum(SHAPE_SKINS).optional(),
        trombi: z.enum(TROMBI_SKINS).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MascotLook = z.infer<typeof mascotLookSchema>;

export const DEFAULT_MASCOT_LOOK: MascotLook = Object.freeze({ character: "owl" }) as MascotLook;

/** A stored or received look, or the owl when absent or malformed. */
export function botMascotLook(value: unknown): MascotLook {
  return mascotLookSchema.safeParse(value).data ?? DEFAULT_MASCOT_LOOK;
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
