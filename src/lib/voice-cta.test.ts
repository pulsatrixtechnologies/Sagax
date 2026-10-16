import { describe, expect, it } from "vitest";
import { contrastRatio, MASCOT_COLOR_HEX, MASCOT_COLOR_NAMES } from "../../shared/mascot-colors";
import { botCtaColors, CTA_MIN_CONTRAST, isColorless } from "./voice-cta";

describe("botCtaColors", () => {
  it("keeps every bot color's white glyph at 3:1 or more, hover included", () => {
    for (const name of MASCOT_COLOR_NAMES) {
      const colors = botCtaColors(name);
      if (!colors) continue;
      expect(contrastRatio(colors.ink, colors.fill), name).toBeGreaterThanOrEqual(CTA_MIN_CONTRAST);
      expect(contrastRatio(colors.ink, colors.hover), name).toBeGreaterThanOrEqual(CTA_MIN_CONTRAST);
    }
  });

  it("follows the bot: pink and teal give two different fills", () => {
    const pink = botCtaColors("pink");
    const teal = botCtaColors("teal");
    expect(pink && teal).toBeTruthy();
    expect(pink!.fill).not.toBe(teal!.fill);
    // a color that already reads keeps its own value
    expect(pink!.fill).toBe(MASCOT_COLOR_HEX.pink.toLowerCase());
  });

  it("darkens a light color instead of dropping it", () => {
    const butter = botCtaColors("butter");
    expect(butter).not.toBeNull();
    expect(butter!.fill).not.toBe(MASCOT_COLOR_HEX.butter.toLowerCase());
  });

  it("leaves colorless bots on the default button", () => {
    for (const name of ["white", "grey", "black", "graphite", "silver", "ash", "ink", "cream"] as const) {
      expect(isColorless(MASCOT_COLOR_HEX[name]), name).toBe(true);
      expect(botCtaColors(name), name).toBeNull();
    }
    expect(botCtaColors(undefined)).toBeNull();
    expect(botCtaColors("not-a-color")).toBeNull();
  });
});
