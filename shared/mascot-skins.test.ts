import { describe, expect, it } from "vitest";

import { DEFAULT_MASCOT_SKIN, MASCOT_SKIN_IDS, botMascotSkin } from "./mascot-skins";

describe("mascot skins", () => {
  it("starts with none, the default every legacy bot wears", () => {
    expect(MASCOT_SKIN_IDS[0]).toBe("none");
    expect(DEFAULT_MASCOT_SKIN).toBe("none");
  });

  it("offers lightning and at least three more special editions", () => {
    expect(MASCOT_SKIN_IDS).toContain("lightning");
    expect(MASCOT_SKIN_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps known skins as they are", () => {
    for (const skin of MASCOT_SKIN_IDS) expect(botMascotSkin(skin)).toBe(skin);
  });

  it("reads missing, legacy and junk values as none", () => {
    for (const value of [undefined, null, "", "plasma", 42, { skin: "gold" }, "GOLD"]) {
      expect(botMascotSkin(value)).toBe("none");
    }
  });
});
