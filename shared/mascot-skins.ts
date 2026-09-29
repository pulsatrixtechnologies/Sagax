/**
 * The skins a bot's mascot can wear: special editions layered over its body
 * and colour, never replacing either choice.
 *
 * A skin is purely cosmetic, so an unknown or missing value is never an
 * error: bots saved before skins existed, or by a newer build with a skin
 * this one does not know, simply wear `none`.
 */
import { z } from "zod";

/** Every selectable skin id, in the order the picker shows them. */
export const MASCOT_SKIN_IDS = ["none", "lightning", "gold", "neon", "inferno", "frost", "carbon"] as const;

export type MascotSkinId = (typeof MASCOT_SKIN_IDS)[number];

export const DEFAULT_MASCOT_SKIN: MascotSkinId = "none";

export const mascotSkinSchema = z.enum(MASCOT_SKIN_IDS);

/** Resolves any stored value, current, legacy or junk, to a real skin. */
export function botMascotSkin(value: unknown): MascotSkinId {
  return mascotSkinSchema.safeParse(value).data ?? DEFAULT_MASCOT_SKIN;
}
