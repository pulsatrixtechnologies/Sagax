// Skin families (JC, 2026-10-19): "chaque skin devrait avoir ses propres
// variantes au lieu d'avoir des skins très proches visuellement". The twelve
// skins of src/lib/skins.ts are grouped into a few families, each with its
// own identity (type, radii, how the rail and the bubbles are drawn); the
// skins that only differed by a tint or by light and dark are the variants
// of one family.
//
// Nothing about a skin's look moved: a variant in a mode IS one of the old
// skins, and `omb-skin` still holds that concrete id (the CSS block, the
// Windows caption overlay, the phone's "Same as my computer" and every older
// build read it unchanged). The one new choice is Auto, kept beside it in
// `omb-skin-mode` ("auto"): the variant's light or dark skin, following the
// system. A family, a variant and a mode are therefore always derived from
// the worn skin, so every saved choice, old or new, maps to itself.
import type { SkinId } from "./skins";

export type SkinScheme = "light" | "dark";
/** What the person picked: one scheme, or Auto (follow the system). */
export type SkinModeChoice = SkinScheme | "auto";

export const SKIN_FAMILY_IDS = ["pulsatrix", "studio", "atelier", "retro98"] as const;
export type SkinFamilyId = (typeof SKIN_FAMILY_IDS)[number];

export const SKIN_VARIANT_IDS = ["blue", "neutral", "slate", "plum", "meadow", "brass", "lagoon", "classic"] as const;
export type SkinVariantId = (typeof SKIN_VARIANT_IDS)[number];

export type SkinVariant = {
  id: SkinVariantId;
  /** The skin worn in a light mode, when the variant has one. */
  light?: SkinId;
  /** The skin worn in a dark mode, when the variant has one. */
  dark?: SkinId;
};

export type SkinFamily = {
  id: SkinFamilyId;
  name: string;
  variants: readonly SkinVariant[];
  /** A secret family: the picker lists it once this device has unlocked it. */
  secret?: boolean;
};

export const SKIN_FAMILIES: readonly SkinFamily[] = [
  // Perspicax's own look: Geist, navy chrome, the soft glow from the top.
  { id: "pulsatrix", name: "Pulsatrix", variants: [{ id: "blue", light: "pulsatrix-light", dark: "pulsatrix" }] },
  // Grok Bot's flat neutral look: Inter, monochrome buttons, inverted bubbles in light.
  {
    id: "studio",
    name: "Studio",
    variants: [
      { id: "neutral", light: "daylight", dark: "midnight" },
      { id: "slate", light: "linen", dark: "graphite" },
      { id: "plum", dark: "dusk" },
      { id: "meadow", light: "meadow" },
    ],
  },
  // Paper: a tinted ground where surfaces get brighter as they rise.
  {
    id: "atelier",
    name: "Atelier",
    variants: [
      { id: "brass", light: "atelier", dark: "foundry" },
      { id: "lagoon", light: "lagoon" },
    ],
  },
  // Bevelled late-90s windows and classic scrollbars; keeps its own style.
  { id: "retro98", name: "Hibou 98", secret: true, variants: [{ id: "classic", light: "retro98" }] },
];

export type SkinPlace = { family: SkinFamily; variant: SkinVariant; scheme: SkinScheme };

const PLACES: ReadonlyMap<SkinId, SkinPlace> = (() => {
  const map = new Map<SkinId, SkinPlace>();
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.light) map.set(variant.light, { family, variant, scheme: "light" });
      if (variant.dark) map.set(variant.dark, { family, variant, scheme: "dark" });
    }
  }
  return map;
})();

/** Where a worn skin sits: its family, its variant and its scheme. Every skin id has one place. */
export function placeOfSkin(skin: SkinId): SkinPlace {
  const place = PLACES.get(skin);
  // Every SKIN_IDS entry is in the table (skin-families.test.ts); a missing one is a programming error.
  if (!place) throw new Error(`skin ${skin} belongs to no family`);
  return place;
}

/** Every skin, each in exactly one family (checked by the tests against SKIN_IDS). */
export function familySkins(): SkinId[] {
  return [...PLACES.keys()];
}

export function schemesOf(variant: SkinVariant): SkinScheme[] {
  const out: SkinScheme[] = [];
  if (variant.light) out.push("light");
  if (variant.dark) out.push("dark");
  return out;
}

/** True when the variant has both a light and a dark skin, so Auto can follow the system. */
export function canFollowSystem(variant: SkinVariant): boolean {
  return Boolean(variant.light && variant.dark);
}

/** The variant's skin for a scheme, or the one scheme it has. */
export function variantSkin(variant: SkinVariant, scheme: SkinScheme): SkinId {
  const wanted = scheme === "light" ? variant.light : variant.dark;
  // SAFETY: every variant declares at least one of the two (skin-families.test.ts).
  return (wanted ?? variant.light ?? variant.dark) as SkinId;
}

export function findFamily(id: string): SkinFamily | undefined {
  return SKIN_FAMILIES.find((family) => family.id === id);
}

export function findVariant(family: SkinFamily, id: string): SkinVariant | undefined {
  return family.variants.find((variant) => variant.id === id);
}

/** The families the picker shows: every public one, plus a secret one unlocked here or worn now. */
export function visibleFamilies(unlocked: boolean, active?: SkinFamilyId): readonly SkinFamily[] {
  return SKIN_FAMILIES.filter((family) => !family.secret || unlocked || family.id === active);
}

/**
 * The skin to wear for a choice. `prefersDark` is the system's scheme, read
 * only for Auto. A mode the variant lacks falls to the one it has (Plum is
 * dark only, Meadow light only), and Auto on such a variant is that skin.
 */
export function resolveSkin(variant: SkinVariant, mode: SkinModeChoice, prefersDark: boolean): SkinId {
  const scheme: SkinScheme = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
  return variantSkin(variant, scheme);
}

/**
 * The variant a family opens on when it is picked from the grid: the variant
 * remembered for it (the person's last one there), else its first variant
 * that has the scheme worn now, else its first.
 */
export function defaultVariant(family: SkinFamily, scheme: SkinScheme, remembered?: string | null): SkinVariant {
  const kept = remembered ? findVariant(family, remembered) : undefined;
  if (kept) return kept;
  return family.variants.find((variant) => (scheme === "light" ? variant.light : variant.dark)) ?? family.variants[0];
}

/** The mode a new variant keeps: Auto while the variant can follow the system, else the scheme it can show. */
export function carryMode(variant: SkinVariant, mode: SkinModeChoice, scheme: SkinScheme): SkinModeChoice {
  if (mode === "auto") return canFollowSystem(variant) ? "auto" : schemesOf(variant)[0];
  const schemes = schemesOf(variant);
  return schemes.includes(mode) ? mode : schemes.includes(scheme) ? scheme : schemes[0];
}

// ── Stored choice ────────────────────────────────────────────────────────
// `omb-skin` (skins.ts) is the worn skin; these two keys add what a single id
// cannot say: Auto, and the last variant picked in each family.

export const SKIN_MODE_KEY = "omb-skin-mode";
export const SKIN_VARIANTS_KEY = "omb-skin-variants";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Store | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** True when the person chose Auto. Anything else (absent, an old build's value) is a fixed skin. */
export function readSkinAuto(storage: Store | undefined = store()): boolean {
  try {
    return storage?.getItem(SKIN_MODE_KEY) === "auto";
  } catch {
    return false;
  }
}

export function writeSkinAuto(auto: boolean, storage: Store | undefined = store()): void {
  try {
    if (auto) storage?.setItem(SKIN_MODE_KEY, "auto");
    else storage?.removeItem(SKIN_MODE_KEY);
  } catch {
    /* private mode: the choice lasts this session */
  }
}

/** The last variant picked per family, as stored (bad JSON or values are ignored). */
export function readRememberedVariants(storage: Store | undefined = store()): Partial<Record<SkinFamilyId, SkinVariantId>> {
  try {
    const raw = storage?.getItem(SKIN_VARIANTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Partial<Record<SkinFamilyId, SkinVariantId>> = {};
    for (const family of SKIN_FAMILIES) {
      const value = (parsed as Record<string, unknown>)[family.id];
      if (typeof value === "string" && findVariant(family, value)) out[family.id] = value as SkinVariantId;
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberVariant(family: SkinFamilyId, variant: SkinVariantId, storage: Store | undefined = store()): void {
  const next = { ...readRememberedVariants(storage), [family]: variant };
  try {
    storage?.setItem(SKIN_VARIANTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

/** The light and dark skin of every variant that has both: the first-paint script resolves Auto with it. */
export function autoPairs(): Record<string, [SkinId, SkinId]> {
  const out: Record<string, [SkinId, SkinId]> = {};
  for (const family of SKIN_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.light && variant.dark) {
        out[variant.light] = [variant.light, variant.dark];
        out[variant.dark] = [variant.light, variant.dark];
      }
    }
  }
  return out;
}
