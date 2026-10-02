// The avatar popover's tabs, as pure functions (MascotLookEditor.tsx): skins
// grouped by rarity (Common, Rare, Epic, Legendary) and colors grouped by
// palette (Vivid, Pastel, Deep, Neon, Neutral). The popover opens on the tab
// of the current choice and follows it when it changes elsewhere (Reset).
import { MASCOT_COLOR_GROUPS, mascotColorGroup, mascotColorsIn, type MascotColorGroup, type MascotColorName } from "../../../shared/mascot-colors";
import type { SkinTier } from "../../../shared/mascot-look";

/** The rarity tabs, in order. */
export const SKIN_TIERS: readonly SkinTier[] = ["common", "rare", "epic", "legendary"];

export interface TierTab<S extends string> {
  tier: SkinTier;
  skins: S[];
  count: number;
}

/** A character's skins by rarity, in the picker's order; a rarity with no skin has no tab. */
export function skinTierTabs<S extends string>(skins: readonly S[], tierOf: Readonly<Record<S, SkinTier>>): TierTab<S>[] {
  return SKIN_TIERS.map((tier) => {
    const inTier = skins.filter((skin) => tierOf[skin] === tier);
    return { tier, skins: inTier, count: inTier.length };
  }).filter((tab) => tab.count > 0);
}

/** The tab the picker opens on: the current skin's rarity, else the first tab. */
export function skinTabFor<S extends string>(selected: S | null | undefined, skins: readonly S[], tierOf: Readonly<Record<S, SkinTier>>): SkinTier {
  const tabs = skinTierTabs(skins, tierOf);
  const tier = selected != null && (skins as readonly string[]).includes(selected) ? tierOf[selected] : undefined;
  return tabs.find((tab) => tab.tier === tier)?.tier ?? tabs[0]?.tier ?? "common";
}

export interface ColorTab {
  group: MascotColorGroup;
  colors: MascotColorName[];
}

/** The palette tabs, each with its colors in the swatch row's order. */
export function colorTabs(): ColorTab[] {
  return MASCOT_COLOR_GROUPS.map((group) => ({ group, colors: mascotColorsIn(group) }));
}

/** The palette tab the picker opens on: the current color's own (an unknown color opens Vivid). */
export function colorTabFor(color: string | null | undefined): MascotColorGroup {
  return mascotColorGroup(color);
}

/** Moving across a tab list with the arrow keys, Home and End (wraps around). */
export function nextTab<T>(tabs: readonly T[], current: T, key: string): T | null {
  const index = tabs.indexOf(current);
  if (key === "ArrowRight") return tabs[(index + 1) % tabs.length];
  if (key === "ArrowLeft") return tabs[(index - 1 + tabs.length) % tabs.length];
  if (key === "Home") return tabs[0];
  if (key === "End") return tabs[tabs.length - 1];
  return null;
}
