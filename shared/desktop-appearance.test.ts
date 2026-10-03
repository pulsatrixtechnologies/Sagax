import { describe, expect, it } from "vitest";
import { SKIN_IDS } from "../src/lib/skins.ts";
import { FONT_IDS } from "../src/lib/fonts.ts";
import { APPEARANCE_FONT_IDS, APPEARANCE_SKIN_IDS, DESKTOP_APPEARANCE_KEYS, cleanDesktopAppearance, sameAppearance } from "./desktop-appearance.ts";
import { USER_PREFERENCE_KEYS } from "./user-preferences.ts";

describe("desktop appearance keys", () => {
  it("lists the renderer's skins and fonts, and travels as user preferences do", () => {
    expect([...APPEARANCE_SKIN_IDS]).toEqual([...SKIN_IDS]);
    expect([...APPEARANCE_FONT_IDS]).toEqual([...FONT_IDS]);
    for (const key of DESKTOP_APPEARANCE_KEYS) expect(USER_PREFERENCE_KEYS).toContain(key);
  });

  it("keeps valid values of the four keys only", () => {
    expect(cleanDesktopAppearance({
      "omb-skin": "lagoon", "omb-font": "serif", "omb.retro98.on": "1", "omb.retro98.unlocked": "1",
      "omb-language": "fr", "omb-drafts": "{}",
    })).toEqual({ "omb-skin": "lagoon", "omb-font": "serif", "omb.retro98.on": "1", "omb.retro98.unlocked": "1" });
    expect(cleanDesktopAppearance({ "omb-skin": "black", "omb-font": "comic", "omb.retro98.on": "yes", "omb.retro98.unlocked": 1 })).toEqual({});
    expect(cleanDesktopAppearance(["omb-skin"])).toEqual({});
    expect(cleanDesktopAppearance(null)).toEqual({});
    expect(sameAppearance({ "omb-skin": "dusk" }, { "omb-skin": "dusk" })).toBe(true);
    expect(sameAppearance({ "omb-skin": "dusk" }, {})).toBe(false);
  });
});
