// Skin families (2026-10-19): every old skin id is one variant of one family
// in one scheme, so a saved choice maps to itself; Auto follows the system
// between a variant's light and dark skins; the first-paint script in
// index.html carries the same pairs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autoPairs,
  canFollowSystem,
  carryMode,
  defaultVariant,
  familySkins,
  findFamily,
  placeOfSkin,
  readRememberedVariants,
  readSkinAuto,
  rememberVariant,
  resolveSkin,
  SKIN_FAMILIES,
  SKIN_MODE_KEY,
  SKIN_VARIANTS_KEY,
  variantSkin,
  visibleFamilies,
  writeSkinAuto,
} from "./skin-families";
import { resolveStoredSkin, SKIN_IDS, SKINS } from "./skins";

function memoryStore(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("skin families", () => {
  it("puts every skin in exactly one family, variant and scheme", () => {
    expect([...familySkins()].sort()).toEqual([...SKIN_IDS].sort());
    expect(new Set(familySkins()).size).toBe(SKIN_IDS.length);
    for (const family of SKIN_FAMILIES) {
      expect(family.variants.length).toBeGreaterThan(0);
      for (const variant of family.variants) expect(variant.light ?? variant.dark).toBeTruthy();
    }
  });

  it("maps every old skin id to itself: the same family, variant and scheme wear the same skin", () => {
    for (const id of SKIN_IDS) {
      const place = placeOfSkin(id);
      expect(variantSkin(place.variant, place.scheme), id).toBe(id);
      expect(resolveSkin(place.variant, place.scheme, false), id).toBe(id);
      // a stored id with no Auto is worn as is
      expect(resolveStoredSkin(id, false, true)).toBe(id);
      expect(resolveStoredSkin(id, false, false)).toBe(id);
    }
  });

  it("groups the look-alikes as variants (JC's examples)", () => {
    const family = (id: (typeof SKIN_IDS)[number]) => placeOfSkin(id).family.id;
    // Midnight, Graphite and Dusk: one family
    expect(new Set(["midnight", "graphite", "dusk"].map((id) => family(id as never)))).toEqual(new Set(["studio"]));
    // Linen, Daylight and Meadow: one family; Pulsatrix Light with Pulsatrix
    expect(new Set(["linen", "daylight", "meadow"].map((id) => family(id as never)))).toEqual(new Set(["studio"]));
    expect(family("pulsatrix-light")).toBe("pulsatrix");
    expect(placeOfSkin("pulsatrix-light").variant).toBe(placeOfSkin("pulsatrix").variant);
    expect(placeOfSkin("daylight").variant).toBe(placeOfSkin("midnight").variant);
    expect(placeOfSkin("atelier").variant).toBe(placeOfSkin("foundry").variant);
    // Hibou 98 stays a family of its own, secret like the skin
    expect(placeOfSkin("retro98").family.id).toBe("retro98");
    expect(findFamily("retro98")?.secret).toBe(true);
    expect(SKINS.find((skin) => skin.id === "retro98")?.secret).toBe(true);
  });

  it("offers Auto only on a variant with a light and a dark skin", () => {
    const studio = findFamily("studio")!;
    const neutral = studio.variants.find((v) => v.id === "neutral")!;
    const plum = studio.variants.find((v) => v.id === "plum")!;
    const meadow = studio.variants.find((v) => v.id === "meadow")!;
    expect(canFollowSystem(neutral)).toBe(true);
    expect(canFollowSystem(plum)).toBe(false);
    expect(resolveSkin(neutral, "auto", true)).toBe("midnight");
    expect(resolveSkin(neutral, "auto", false)).toBe("daylight");
    // a missing scheme falls to the one the variant has
    expect(resolveSkin(plum, "light", false)).toBe("dusk");
    expect(resolveSkin(meadow, "dark", true)).toBe("meadow");
    expect(resolveSkin(meadow, "auto", true)).toBe("meadow");
  });

  it("carries the mode to a new variant: Auto where it can, else a scheme the variant has", () => {
    const studio = findFamily("studio")!;
    const [neutral, slate, plum, meadow] = studio.variants;
    expect(carryMode(slate, "auto", "dark")).toBe("auto");
    expect(carryMode(plum, "auto", "light")).toBe("dark");
    expect(carryMode(meadow, "dark", "dark")).toBe("light");
    expect(carryMode(neutral, "light", "light")).toBe("light");
  });

  it("opens a family on its remembered variant, else one that has the scheme worn now", () => {
    const studio = findFamily("studio")!;
    const atelier = findFamily("atelier")!;
    expect(defaultVariant(studio, "dark").id).toBe("neutral");
    expect(defaultVariant(studio, "dark", "plum").id).toBe("plum");
    expect(defaultVariant(studio, "dark", "nope").id).toBe("neutral");
    expect(defaultVariant(atelier, "dark").id).toBe("brass");
  });

  it("lists Hibou 98 once unlocked or worn", () => {
    expect(visibleFamilies(false).map((f) => f.id)).not.toContain("retro98");
    expect(visibleFamilies(true).map((f) => f.id)).toContain("retro98");
    expect(visibleFamilies(false, "retro98").map((f) => f.id)).toContain("retro98");
  });
});

describe("stored choice", () => {
  it("reads Auto only from the exact value; anything else is a fixed skin", () => {
    expect(readSkinAuto(memoryStore())).toBe(false);
    expect(readSkinAuto(memoryStore({ [SKIN_MODE_KEY]: "auto" }))).toBe(true);
    expect(readSkinAuto(memoryStore({ [SKIN_MODE_KEY]: "AUTO" }))).toBe(false);
    const store = memoryStore();
    writeSkinAuto(true, store);
    expect(store.data.get(SKIN_MODE_KEY)).toBe("auto");
    writeSkinAuto(false, store);
    expect(store.data.has(SKIN_MODE_KEY)).toBe(false);
  });

  it("resolves a stored skin under Auto for the system's scheme", () => {
    expect(resolveStoredSkin("midnight", true, false)).toBe("daylight");
    expect(resolveStoredSkin("daylight", true, true)).toBe("midnight");
    expect(resolveStoredSkin("pulsatrix-light", true, true)).toBe("pulsatrix");
    expect(resolveStoredSkin("foundry", true, false)).toBe("atelier");
    // no pair: worn as is
    expect(resolveStoredSkin("dusk", true, false)).toBe("dusk");
    expect(resolveStoredSkin("retro98", true, true)).toBe("retro98");
    // unknown: the default skin, then Auto
    expect(resolveStoredSkin("nope", false, true)).toBe("pulsatrix");
    expect(resolveStoredSkin(null, true, false)).toBe("pulsatrix-light");
  });

  it("remembers the last variant per family and ignores bad values", () => {
    const store = memoryStore({ [SKIN_VARIANTS_KEY]: JSON.stringify({ studio: "plum", atelier: "neutral", nope: "x" }) });
    expect(readRememberedVariants(store)).toEqual({ studio: "plum" });
    rememberVariant("atelier", "lagoon", store);
    expect(readRememberedVariants(store)).toEqual({ studio: "plum", atelier: "lagoon" });
    expect(readRememberedVariants(memoryStore({ [SKIN_VARIANTS_KEY]: "{" }))).toEqual({});
    expect(readRememberedVariants(memoryStore({ [SKIN_VARIANTS_KEY]: "[1]" }))).toEqual({});
  });
});

describe("first paint", () => {
  it("index.html carries the skin ids and the Auto pairs of the families", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const skins = JSON.parse(/var SKINS = (\[[^\]]*\]);/.exec(html)?.[1] ?? "null");
    const pairs = JSON.parse(/var PAIRS = (\{[^\n]*\});/.exec(html)?.[1] ?? "null");
    expect(skins).toEqual([...SKIN_IDS]);
    expect(pairs).toEqual(autoPairs());
    expect(html).toContain(`localStorage.getItem("${SKIN_MODE_KEY}")`);
  });
});
