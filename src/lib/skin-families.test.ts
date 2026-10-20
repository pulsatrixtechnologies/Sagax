// Skin families (2026-10-19): every base skin is a variant of one family in
// one scheme, a colour or a Windows edition is a tint over it, and the
// retired look-alikes are worn as the closest base and colour; Auto follows the system
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
  LEGACY_SKINS,
  legacyPairs,
  normalizeWorn,
  placeOfSkin,
  readRememberedVariants,
  readSkinAuto,
  rememberVariant,
  resolveSkin,
  SKIN_FAMILIES,
  SKIN_MODE_KEY,
  SKIN_VARIANTS_KEY,
  SKIN_WINDOWS_TINTS,
  tintsBySkin,
  variantSkin,
  visibleFamilies,
  writeSkinAuto,
} from "./skin-families";
import { resolveStoredSkin, SKIN_IDS, SKIN_TINT_KEY, SKINS } from "./skins";

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
  it("puts every base skin in a family, and maps every other skin id as a legacy colour", () => {
    const bases = new Set(familySkins());
    for (const id of SKIN_IDS) expect(bases.has(id) !== Boolean(LEGACY_SKINS[id]), id).toBe(true);
    for (const legacy of Object.values(LEGACY_SKINS)) expect(bases.has(legacy!.skin)).toBe(true);
    for (const family of SKIN_FAMILIES) {
      expect(family.variants.length).toBeGreaterThan(0);
      for (const variant of family.variants) expect(variant.light ?? variant.dark).toBeTruthy();
    }
  });

  it("gives Pulsatrix, Studio and Atelier their own look plus each colour (JC, 2026-10-19)", () => {
    const ids = (family: string) => findFamily(family)!.variants.map((v) => v.id);
    expect(ids("studio")).toEqual(["basic", "red", "pink", "blue", "green", "yellow"]);
    expect(ids("atelier")).toEqual(["basic", "red", "pink", "blue", "green", "yellow"]);
    // Pulsatrix's own colour is already blue
    expect(ids("pulsatrix")).toEqual(["basic", "red", "pink", "green", "yellow"]);
    for (const family of ["pulsatrix", "studio", "atelier"]) {
      for (const variant of findFamily(family)!.variants) {
        expect(canFollowSystem(variant), `${family} ${variant.id}`).toBe(true);
        expect(variant.tint ?? null).toBe(variant.id === "basic" ? null : variant.id);
      }
    }
  });

  it("gives Hibou 98 the classic look plus each Windows edition, all on the retro98 skin", () => {
    const retro = findFamily("retro98")!;
    expect(retro.variants.map((v) => v.id)).toEqual(["classic", ...SKIN_WINDOWS_TINTS]);
    for (const variant of retro.variants) expect(variantSkin(variant, "light")).toBe("retro98");
    expect(findFamily("retro98")?.secret).toBe(true);
    expect(SKINS.find((skin) => skin.id === "retro98")?.secret).toBe(true);
  });

  it("places a worn skin and tint, and wears the same pair back", () => {
    for (const family of SKIN_FAMILIES) {
      for (const variant of family.variants) {
        for (const scheme of ["light", "dark"] as const) {
          const skin = variantSkin(variant, scheme);
          const place = placeOfSkin(skin, variant.tint);
          expect(place.family.id).toBe(family.id);
          expect(place.variant.id).toBe(variant.id);
          expect(variantSkin(place.variant, place.scheme)).toBe(skin);
        }
      }
    }
    // no tint, or one the family lacks: the family's own look
    expect(placeOfSkin("midnight").variant.id).toBe("basic");
    expect(placeOfSkin("pulsatrix", "blue").variant.id).toBe("basic");
    expect(placeOfSkin("retro98", "red").variant.id).toBe("classic");
  });

  it("wears the retired look-alikes as the closest base and colour", () => {
    expect(normalizeWorn("graphite", null)).toEqual({ skin: "midnight", tint: "blue" });
    expect(normalizeWorn("linen", "red")).toEqual({ skin: "daylight", tint: "blue" });
    expect(normalizeWorn("dusk", null)).toEqual({ skin: "midnight", tint: "pink" });
    expect(normalizeWorn("meadow", null)).toEqual({ skin: "daylight", tint: "green" });
    expect(normalizeWorn("lagoon", null)).toEqual({ skin: "atelier", tint: "blue" });
    const place = placeOfSkin("dusk");
    expect([place.family.id, place.variant.id, place.scheme]).toEqual(["studio", "pink", "dark"]);
    // a tint stays only where its family has it
    expect(normalizeWorn("midnight", "xp")).toEqual({ skin: "midnight", tint: null });
    expect(normalizeWorn("retro98", "win11")).toEqual({ skin: "retro98", tint: "win11" });
  });

  it("follows the system on every colour, and carries the mode to a new variant", () => {
    const studio = findFamily("studio")!;
    const red = studio.variants.find((v) => v.id === "red")!;
    expect(resolveSkin(red, "auto", true)).toBe("midnight");
    expect(resolveSkin(red, "auto", false)).toBe("daylight");
    expect(carryMode(red, "auto", "dark")).toBe("auto");
    expect(carryMode(red, "light", "light")).toBe("light");
    const classic = findFamily("retro98")!.variants[0];
    expect(canFollowSystem(classic)).toBe(false);
    expect(carryMode(classic, "auto", "dark")).toBe("light");
  });

  it("opens a family on its remembered variant, else its own look", () => {
    const studio = findFamily("studio")!;
    const atelier = findFamily("atelier")!;
    expect(defaultVariant(studio, "dark").id).toBe("basic");
    expect(defaultVariant(studio, "dark", "pink").id).toBe("pink");
    expect(defaultVariant(studio, "dark", "plum").id).toBe("basic");
    expect(defaultVariant(atelier, "dark").id).toBe("basic");
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
    // a retired look-alike: its base, then Auto
    expect(resolveStoredSkin("dusk", true, false)).toBe("daylight");
    expect(resolveStoredSkin("dusk", false, false)).toBe("midnight");
    // no pair: worn as is
    expect(resolveStoredSkin("retro98", true, true)).toBe("retro98");
    // unknown: the default skin, then Auto
    expect(resolveStoredSkin("nope", false, true)).toBe("pulsatrix");
    expect(resolveStoredSkin(null, true, false)).toBe("pulsatrix-light");
  });

  it("remembers the last variant per family and ignores bad values", () => {
    const store = memoryStore({ [SKIN_VARIANTS_KEY]: JSON.stringify({ studio: "pink", atelier: "plum", retro98: "xp", nope: "x" }) });
    expect(readRememberedVariants(store)).toEqual({ studio: "pink", retro98: "xp" });
    rememberVariant("atelier", "green", store);
    expect(readRememberedVariants(store)).toEqual({ studio: "pink", atelier: "green", retro98: "xp" });
    expect(readRememberedVariants(memoryStore({ [SKIN_VARIANTS_KEY]: "{" }))).toEqual({});
    expect(readRememberedVariants(memoryStore({ [SKIN_VARIANTS_KEY]: "[1]" }))).toEqual({});
  });
});

describe("first paint", () => {
  it("index.html carries the skin ids and the Auto pairs of the families", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const skins = JSON.parse(/var SKINS = (\[[^\]]*\]);/.exec(html)?.[1] ?? "null");
    const pairs = JSON.parse(/var PAIRS = (\{[^\n]*\});/.exec(html)?.[1] ?? "null");
    const legacy = JSON.parse(/var LEGACY = (\{[^\n]*\});/.exec(html)?.[1] ?? "null");
    const tints = JSON.parse(/var TINTS = (\{[^\n]*\});/.exec(html)?.[1] ?? "null");
    expect(skins).toEqual([...SKIN_IDS]);
    expect(pairs).toEqual(autoPairs());
    expect(legacy).toEqual(legacyPairs());
    expect(tints).toEqual(tintsBySkin());
    expect(html).toContain(`localStorage.getItem("${SKIN_TINT_KEY}")`);
    expect(html).toContain(`localStorage.getItem("${SKIN_MODE_KEY}")`);
  });
});
