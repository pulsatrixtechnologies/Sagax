import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BACKGROUND_EFFECT_IDS, BACKGROUND_EFFECTS, effectPalette, INTENSITIES, INTENSITY_GAIN, isBackgroundEffectId, PALETTE_IDS, resolvePalette } from "./background-effects";
import { CLICK_BOOST, fragmentShader, SHADER_SOURCES } from "./background-shaders";

const catalogs: Record<string, Record<string, string>> = { en, fr };

describe("background effects registry", () => {
  it("lists every id once, None first, and at least ten real effects", () => {
    expect(BACKGROUND_EFFECTS.map((effect) => effect.id)).toEqual([...BACKGROUND_EFFECT_IDS]);
    expect(BACKGROUND_EFFECTS[0]).toMatchObject({ id: "none", kind: "none", palettes: [] });
    const real = BACKGROUND_EFFECTS.filter((effect) => effect.kind !== "none");
    expect(real.length).toBeGreaterThanOrEqual(10);
    expect(real.find((effect) => effect.id === "glyphs")?.kind).toBe("glyphs");
  });

  it("gives every shader effect its own shader, and nothing else one", () => {
    const sources = new Set<string>();
    for (const effect of BACKGROUND_EFFECTS) {
      const source = fragmentShader(effect.id);
      if (effect.kind === "shader") {
        expect(source, effect.id).toContain("vec4 effect(vec2 p)");
        expect(source).toContain("uClicks");
        sources.add(SHADER_SOURCES[effect.id]!);
      } else {
        expect(source, effect.id).toBeNull();
      }
    }
    // every shader effect is a different program
    expect(sources.size).toBe(BACKGROUND_EFFECTS.filter((effect) => effect.kind === "shader").length);
    for (const id of Object.keys(CLICK_BOOST)) expect(isBackgroundEffectId(id)).toBe(true);
  });

  it("offers several known palettes per effect, the first being the default", () => {
    for (const effect of BACKGROUND_EFFECTS) {
      if (effect.kind === "none") continue;
      expect(effect.palettes.length, effect.id).toBeGreaterThanOrEqual(4);
      expect(new Set(effect.palettes).size).toBe(effect.palettes.length);
      for (const palette of effect.palettes) expect(PALETTE_IDS).toContain(palette);
      expect(effectPalette(effect.id, undefined)).toBe(effect.palettes[0]);
    }
    // a palette the effect does not offer falls back to its default
    expect(effectPalette("synthwave", "mono")).toBe("neon");
    expect(effectPalette("synthwave", "ocean")).toBe("ocean");
  });

  it("resolves every palette in both schemes to colours in range", () => {
    const theme = { ink: { r: 0.9, g: 0.9, b: 0.95 }, tint: { r: 0.3, g: 0.55, b: 1 } };
    for (const palette of PALETTE_IDS) {
      for (const scheme of ["light", "dark"] as const) {
        const colors = resolvePalette(palette, scheme, theme);
        for (const color of [colors.a, colors.b, colors.c]) {
          for (const channel of [color.r, color.g, color.b]) {
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    // Theme follows the skin's tint
    expect(resolvePalette("theme", "dark", theme).a).toEqual(theme.tint);
    expect(INTENSITIES.map((level) => INTENSITY_GAIN[level])).toEqual([0.6, 1, 1.45]);
  });

  it("names and describes every effect and palette in English and French, without long dashes", () => {
    const keys = [
      ...BACKGROUND_EFFECT_IDS.flatMap((id) => [`settings.backgroundEffects.effect.${id}.name`, `settings.backgroundEffects.effect.${id}.description`]),
      ...PALETTE_IDS.map((id) => `settings.backgroundEffects.palette.${id}`),
      ...INTENSITIES.map((id) => `settings.backgroundEffects.intensity.${id}`),
    ];
    for (const [code, catalog] of Object.entries(catalogs)) {
      for (const key of keys) {
        expect(catalog[key], `${code} ${key}`).toBeTruthy();
        expect(catalog[key]).not.toMatch(/[\u2013\u2014]/);
      }
    }
    expect(en).not.toHaveProperty("settings.glyphRipple.title");
  });
});
