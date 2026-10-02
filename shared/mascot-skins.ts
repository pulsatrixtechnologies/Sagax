/**
 * The skins the owl can wear: special editions layered over its body and
 * colour, never replacing either choice. Like the shapes' and Trombi's skins
 * (shared/mascot-look.ts) each has a rarity: Common, Rare, Epic, Legendary.
 *
 * A skin is purely cosmetic, so an unknown or missing value is never an
 * error: bots saved before skins existed, or by a newer build with a skin
 * this one does not know, simply wear `none`. Other names a stored skin may
 * carry (older drafts, the shapes' names) read as the current id.
 */
import { z } from "zod";

/** Every selectable skin id, in the order the picker shows them (by rarity). */
export const MASCOT_SKIN_IDS = ["none", "snowy", "barn", "carbon", "gold", "frost", "neon", "lightning", "chrome", "inferno", "holo", "galaxy", "spirit"] as const;

export type MascotSkinId = (typeof MASCOT_SKIN_IDS)[number];

export const DEFAULT_MASCOT_SKIN: MascotSkinId = "none";

/** How rare an owl skin is: the picker's tab, label and card. */
export const OWL_SKIN_TIER: Readonly<Record<MascotSkinId, "common" | "rare" | "epic" | "legendary">> = {
  none: "common",
  snowy: "common",
  barn: "common",
  carbon: "common",
  gold: "rare",
  frost: "rare",
  neon: "epic",
  lightning: "epic",
  chrome: "epic",
  inferno: "legendary",
  holo: "legendary",
  galaxy: "legendary",
  spirit: "legendary",
};

/** Other names a stored owl skin may carry: it keeps working and is saved back under the current id. */
export const LEGACY_OWL_SKINS: Readonly<Record<string, MascotSkinId>> = {
  classic: "none",
  plain: "none",
  snow: "snowy",
  royal: "gold",
  ice: "frost",
  electric: "lightning",
  metal: "chrome",
  "liquid-metal": "chrome",
  molten: "inferno",
  lava: "inferno",
  fire: "inferno",
  holographic: "holo",
  iridescent: "holo",
  nebula: "galaxy",
  ghost: "spirit",
  ethereal: "spirit",
};

const current = (value: unknown) => (typeof value === "string" && Object.hasOwn(LEGACY_OWL_SKINS, value) ? LEGACY_OWL_SKINS[value] : value);

export const mascotSkinSchema = z.preprocess(current, z.enum(MASCOT_SKIN_IDS));

/** Resolves any stored value, current, legacy or junk, to a real skin. */
export function botMascotSkin(value: unknown): MascotSkinId {
  return mascotSkinSchema.safeParse(value).data ?? DEFAULT_MASCOT_SKIN;
}
