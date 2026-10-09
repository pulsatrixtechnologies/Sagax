// Which Mastery achievement (shared/achievements-catalog.ts, category
// "mastery", docs/achievements.md) unlocks each of the four characters that
// come after the owl, Shapes, Trombi and Bunbu, and each of their skins.
//
// This file is the only place that names them. It imports no art and no
// character module, so it holds before the characters land (feat/mascot-shiba,
// feat/mascot-grump, feat/mascot-ogre, feat/mascot-frog) and keeps holding
// after. A character this build does not draw yet is still locked, still
// listed as a reward, and shown greyed in the achievements modal.
//
// Skins of a Mastery character come in three kinds:
//   - its base skin (plain, or classic): free with the character;
//   - its named skins (Shiba's coats: cream, black and tan, red, sesame,
//     white), in order of rarity: each falls on one of the character's three
//     named rungs, the first ones on the first rung;
//   - the premium set shared by every character: retro98 and gold on the
//     character's own premium rung, then neon, chrome, glitch, holo and
//     molten on the four hardest achievements of the tier.
//
// A mascot branch registers its named skins by appending to `namedSkins`
// below (order: easiest first). A named skin that is not registered yet is
// locked behind the character's last named rung, never free.

export interface MasteryName {
  en: string;
  fr: string;
  ptBR: string;
}

export const MASTERY_CHARACTERS = ["shiba", "grump", "ogre", "frog"] as const;
export type MasteryCharacter = (typeof MASTERY_CHARACTERS)[number];

/** The premium set every Mastery character wears, rarest last. */
export const MASTERY_PREMIUM_SKINS = ["retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"] as const;
export type MasteryPremiumSkin = (typeof MASTERY_PREMIUM_SKINS)[number];

/** Free with the character. */
export const MASTERY_BASE_SKINS: readonly string[] = ["plain", "classic"];

export const MASTERY_PREMIUM_TIER: Readonly<Record<MasteryPremiumSkin, "rare" | "epic" | "legendary">> = {
  retro98: "rare",
  gold: "rare",
  neon: "epic",
  chrome: "epic",
  glitch: "epic",
  holo: "legendary",
  molten: "legendary",
};

export const MASTERY_PREMIUM_NAMES: Readonly<Record<MasteryPremiumSkin, MasteryName>> = {
  retro98: { en: "Retro 98", fr: "Rétro 98", ptBR: "Retrô 98" },
  gold: { en: "Gold", fr: "Or", ptBR: "Ouro" },
  neon: { en: "Neon", fr: "Néon", ptBR: "Neon" },
  chrome: { en: "Chrome", fr: "Chrome", ptBR: "Cromado" },
  glitch: { en: "Glitch", fr: "Glitch", ptBR: "Glitch" },
  holo: { en: "Holographic", fr: "Holographique", ptBR: "Holográfico" },
  molten: { en: "Molten", fr: "Magma", ptBR: "Magma" },
};

export interface MasteryCharacterEntry {
  name: MasteryName;
  /** The achievement that unlocks the character. */
  unlock: string;
  /** The three named rungs, easiest first. */
  namedRungs: readonly [string, string, string];
  /** The character's own premium rung: retro98 and gold. */
  premiumRung: string;
  /** Named skins, easiest first (a mascot branch appends here). */
  namedSkins: ReadonlyArray<{ id: string; name: MasteryName }>;
}

export const MASTERY_UNLOCKS: Readonly<Record<MasteryCharacter, MasteryCharacterEntry>> = {
  // Shiba: delegate and let it run (routines).
  shiba: {
    name: { en: "Shiba", fr: "Shiba", ptBR: "Shiba" },
    unlock: "hands-off",
    namedRungs: ["second-wind", "common-thread", "quiet-nights"],
    premiumRung: "pack-leader",
    namedSkins: [
      { id: "cream", name: { en: "Cream", fr: "Crème", ptBR: "Creme" } },
      { id: "blacktan", name: { en: "Black and Tan", fr: "Noir et feu", ptBR: "Preto e castanho" } },
      { id: "red", name: { en: "Red", fr: "Roux", ptBR: "Vermelho" } },
      { id: "sesame", name: { en: "Sesame", fr: "Sésame", ptBR: "Gergelim" } },
      { id: "white", name: { en: "White", fr: "Blanc", ptBR: "Branco" } },
    ],
  },
  // Grump: read before you trust (approvals, corrections).
  grump: {
    name: { en: "Grump", fr: "Grognon", ptBR: "Rabugento" },
    unlock: "reviewer",
    namedRungs: ["prompter", "red-pen", "not-so-fast"],
    premiumRung: "justice-of-peace",
    namedSkins: [],
  },
  // Ogre: carry the heavy work (rooms, sub-agents, integrations).
  ogre: {
    name: { en: "Ogre", fr: "Ogre", ptBR: "Ogro" },
    unlock: "conductor",
    namedRungs: ["ten-hands", "plugged-in", "swarm"],
    premiumRung: "full-house",
    namedSkins: [
      { id: "swamp", name: { en: "Swamp", fr: "Marais", ptBR: "Pântano" } },
      { id: "moss", name: { en: "Moss", fr: "Mousse", ptBR: "Musgo" } },
      { id: "stone", name: { en: "Stone", fr: "Pierre", ptBR: "Pedra" } },
      { id: "lava", name: { en: "Lava", fr: "Lave", ptBR: "Lava" } },
      { id: "armor", name: { en: "Armor", fr: "Armure", ptBR: "Armadura" } },
    ],
  },
  // Frog: know your models and your knowledge (providers, Auto, skills, memory).
  frog: {
    name: { en: "Frog", fr: "Grenouille", ptBR: "Sapo" },
    unlock: "polyglot",
    namedRungs: ["thrifty", "translator", "skill-smith"],
    premiumRung: "total-recall",
    namedSkins: [],
  },
};

/** The four hardest achievements of the tier: the premium skins of every Mastery character. */
export const MASTERY_PREMIUM_UNLOCKS: Readonly<Record<Exclude<MasteryPremiumSkin, "retro98" | "gold">, string>> = {
  neon: "ferryman",
  chrome: "second-opinion",
  glitch: "clean-slate",
  holo: "sagax-master",
  molten: "sagax-master",
};

export function isMasteryCharacter(character: unknown): character is MasteryCharacter {
  return typeof character === "string" && Object.hasOwn(MASTERY_UNLOCKS, character);
}

function isPremium(skin: string): skin is MasteryPremiumSkin {
  return (MASTERY_PREMIUM_SKINS as readonly string[]).includes(skin);
}

/** The rung (0, 1 or 2) of a named skin: skin i of n falls on floor(3i/n); an unregistered one on the last. */
export function namedRung(entry: MasteryCharacterEntry, skin: string): number {
  const index = entry.namedSkins.findIndex((item) => item.id === skin);
  if (index < 0) return entry.namedRungs.length - 1;
  return Math.min(entry.namedRungs.length - 1, Math.floor((index * entry.namedRungs.length) / entry.namedSkins.length));
}

/**
 * The achievement that unlocks a Mastery character (no skin) or one of its
 * skins, or null when the registry does not govern it: a character from
 * before (owl, shape, trombi, bunbu) or a base skin, free with its character.
 */
export function masteryUnlockFor(character: string, skin?: string): string | null {
  if (!isMasteryCharacter(character)) return null;
  const entry = MASTERY_UNLOCKS[character];
  if (skin === undefined) return entry.unlock;
  if (MASTERY_BASE_SKINS.includes(skin)) return null;
  if (isPremium(skin)) return skin === "retro98" || skin === "gold" ? entry.premiumRung : MASTERY_PREMIUM_UNLOCKS[skin];
  return entry.namedRungs[namedRung(entry, skin)]!;
}

/** The registry's skins of a character, in the picker's order: base, named, premium. */
export function masterySkins(character: MasteryCharacter): string[] {
  return ["plain", ...MASTERY_UNLOCKS[character].namedSkins.map((item) => item.id), ...MASTERY_PREMIUM_SKINS];
}

export type MasteryReward = { kind: "character"; character: MasteryCharacter } | { kind: "skin"; character: MasteryCharacter; skin: string };

/** What an achievement unlocks among the Mastery characters and skins (the catalog's rewards). */
export function masteryRewards(achievement: string): MasteryReward[] {
  const out: MasteryReward[] = [];
  for (const character of MASTERY_CHARACTERS) {
    if (MASTERY_UNLOCKS[character].unlock === achievement) out.push({ kind: "character", character });
    for (const skin of masterySkins(character)) {
      if (MASTERY_BASE_SKINS.includes(skin)) continue;
      if (masteryUnlockFor(character, skin) === achievement) out.push({ kind: "skin", character, skin });
    }
  }
  return out;
}

/** The key the snapshot lists for an unlocked Mastery achievement (its rewards come by registry, not by key). */
export function masteryKey(achievement: string): string {
  return `mastery:${achievement}`;
}

export interface MasteryLock {
  locked: boolean;
  /** The achievement that unlocks it. */
  achievement?: string;
}

/**
 * Is this look locked for someone whose reward keys are `keys`? The helper
 * the look editor, the catalogue and the server's save check call. A Mastery
 * skin also needs its character.
 */
export function masteryLock(keys: ReadonlySet<string>, character: string, skin?: string): MasteryLock {
  const characterAchievement = masteryUnlockFor(character);
  if (!characterAchievement) return { locked: false };
  if (!keys.has(masteryKey(characterAchievement)) && !keys.has(`character:${character}`)) return { locked: true, achievement: characterAchievement };
  if (skin === undefined) return { locked: false };
  const skinAchievement = masteryUnlockFor(character, skin);
  if (!skinAchievement) return { locked: false };
  if (keys.has(masteryKey(skinAchievement)) || keys.has(`skin:${character}:${skin}`)) return { locked: false };
  return { locked: true, achievement: skinAchievement };
}

/** A Mastery character's name, or a skin's (registered named skins and the premium set). */
export function masteryCharacterName(character: MasteryCharacter): MasteryName {
  return MASTERY_UNLOCKS[character].name;
}

export function masterySkinName(character: MasteryCharacter, skin: string): MasteryName {
  if (isPremium(skin)) return MASTERY_PREMIUM_NAMES[skin];
  const named = MASTERY_UNLOCKS[character].namedSkins.find((item) => item.id === skin);
  if (named) return named.name;
  const plain = skin.charAt(0).toUpperCase() + skin.slice(1);
  return { en: plain, fr: plain, ptBR: plain };
}

/** A Mastery skin's rarity: named skins are Rare (they cost a rung), the premium set its own. */
export function masterySkinTier(skin: string): "common" | "rare" | "epic" | "legendary" {
  if (MASTERY_BASE_SKINS.includes(skin)) return "common";
  return isPremium(skin) ? MASTERY_PREMIUM_TIER[skin] : "rare";
}
