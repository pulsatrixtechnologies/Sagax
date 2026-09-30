import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { MASCOT_SKIN_IDS } from "../../../shared/mascot-skins";
import {
  DEFAULT_OPTIONS,
  GUESS_GAP_MS,
  GUESS_REPEAT_MS,
  RETRO_GUESSES,
  RETRO_LOOKS,
  RETRO_TIPS,
  clampPosition,
  idlePhase,
  mayGuess,
  motionPlan,
  nextTip,
  readPrefs,
  searchTips,
  writePrefs,
} from "./logic";

const english = (tip: { text: string }) => (en as Record<string, string>)[tip.text];
const french = (tip: { text: string }) => (fr as Record<string, string>)[tip.text];

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("tips", () => {
  it("has English and Quebec French text for every tip, guess and look", () => {
    const keys = [
      ...RETRO_TIPS.map((tip) => tip.text),
      ...Object.values(RETRO_GUESSES).flatMap((guess) => [guess.question, guess.help, guess.skip]),
      ...RETRO_LOOKS.flatMap((look) => [look.name, look.bio]),
    ];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((fr as Record<string, string>)[key], key).toBeTruthy();
    }
  });

  it("keeps every retro string free of long dashes and of the era's trademarked names", () => {
    const retro = Object.entries({ ...en, ...fr }).filter(([key]) => key.startsWith("retro."));
    for (const catalog of [en, fr] as Array<Record<string, string>>) {
      for (const [key, value] of Object.entries(catalog)) {
        if (!key.startsWith("retro.")) continue;
        expect(value, key).not.toMatch(/[\u2013\u2014]/);
        expect(value.toLowerCase(), key).not.toMatch(/clipp|paperclip|trombone|microsoft|windows 9|office assistant|it looks like you're writing a letter/);
      }
    }
    expect(retro.length).toBeGreaterThan(40);
  });

  it("finds tips by keyword or by their translated text, best match first", () => {
    expect(searchTips("routine", english).map((tip) => tip.id)).toEqual(["routines"]);
    expect(searchTips("thème", french)[0]?.id).toBe("skins");
    expect(searchTips("keyboard shortcut", english)[0]?.id).toBe("shortcuts");
    expect(searchTips("connexion mcp", french)[0]?.id).toBe("mcp");
    expect(searchTips("   ", english)).toEqual([]);
    expect(searchTips("zzzqqq", english)).toEqual([]);
  });

  it("cycles through tips, skipping dismissed and, if asked, keyboard ones", () => {
    const first = nextTip(DEFAULT_OPTIONS, [], null);
    expect(first?.id).toBe(RETRO_TIPS[0].id);
    expect(nextTip(DEFAULT_OPTIONS, [], first!.id)?.id).toBe(RETRO_TIPS[1].id);
    expect(nextTip(DEFAULT_OPTIONS, [RETRO_TIPS[0].id], null)?.id).toBe(RETRO_TIPS[1].id);
    const noKeys = nextTip({ keyboardTips: false }, [], null);
    expect(noKeys?.keyboard).toBeFalsy();
    expect(nextTip(DEFAULT_OPTIONS, RETRO_TIPS.map((tip) => tip.id), null)).toBeNull();
    // wraps around at the end
    expect(nextTip(DEFAULT_OPTIONS, [], RETRO_TIPS.at(-1)!.id)?.id).toBe(RETRO_TIPS[0].id);
  });
});

describe("eager guesses", () => {
  const gate = { now: 1_000_000, options: { guessHelp: true }, dismissed: [] as string[], lastAt: {}, busy: false };

  it("interrupts when allowed", () => {
    expect(mayGuess("longMessage", gate)).toBe(true);
  });

  it("stays quiet when switched off, dismissed, or something is already open", () => {
    expect(mayGuess("paste", { ...gate, options: { guessHelp: false } })).toBe(false);
    expect(mayGuess("paste", { ...gate, dismissed: ["guess:paste"] })).toBe(false);
    expect(mayGuess("paste", { ...gate, busy: true })).toBe(false);
  });

  it("leaves a gap between any two guesses and a longer one before repeating", () => {
    expect(mayGuess("switch", { ...gate, lastAt: { paste: gate.now - GUESS_GAP_MS + 1 } })).toBe(false);
    expect(mayGuess("switch", { ...gate, lastAt: { paste: gate.now - GUESS_GAP_MS } })).toBe(true);
    expect(mayGuess("switch", { ...gate, lastAt: { switch: gate.now - GUESS_REPEAT_MS + 1 } })).toBe(false);
    expect(mayGuess("switch", { ...gate, lastAt: { switch: gate.now - GUESS_REPEAT_MS } })).toBe(true);
  });
});

describe("idle cycle", () => {
  it("looks around, gets bored, yawns, then dozes", () => {
    expect(idlePhase(0)).toBe("awake");
    expect(idlePhase(16_000)).toBe("look");
    expect(idlePhase(31_000)).toBe("bored");
    expect(idlePhase(46_000)).toBe("yawn");
    expect(idlePhase(10 * 60_000)).toBe("doze");
  });
});

describe("reduced motion", () => {
  it("keeps the owl but drops every travelling or bouncing move", () => {
    expect(motionPlan(true)).toEqual({ entrance: "appear", exit: "vanish", flourish: false, travel: false, idleCycle: false });
    expect(motionPlan(false)).toMatchObject({ entrance: "slide-bounce", exit: "puff", flourish: true, travel: true });
  });
});

describe("assistant gallery", () => {
  it("offers the normal and black owls plus every special-edition skin", () => {
    expect(RETRO_LOOKS.map((look) => look.id)).toEqual(["normal", "black", "lightning", "gold", "neon", "inferno", "frost", "carbon"]);
    for (const look of RETRO_LOOKS) expect(MASCOT_SKIN_IDS).toContain(look.skin);
  });
});

describe("preferences", () => {
  it("round-trips and falls back field by field on junk", () => {
    const store = memory();
    expect(readPrefs(store)).toEqual({ options: DEFAULT_OPTIONS, look: "normal", position: null, dismissed: [] });
    writePrefs({ options: { ...DEFAULT_OPTIONS, sounds: false }, look: "gold", position: { right: 40, bottom: 90 }, dismissed: ["escape"] }, store);
    expect(readPrefs(store)).toEqual({ options: { ...DEFAULT_OPTIONS, sounds: false }, look: "gold", position: { right: 40, bottom: 90 }, dismissed: ["escape"] });
    store.setItem("omb.retro98.prefs", JSON.stringify({ options: { sounds: "yes" }, look: "paperclip", position: { right: "x" }, dismissed: [1, "a"] }));
    expect(readPrefs(store)).toEqual({ options: DEFAULT_OPTIONS, look: "normal", position: null, dismissed: ["a"] });
    store.setItem("omb.retro98.prefs", "{not json");
    expect(readPrefs(store).look).toBe("normal");
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readPrefs(broken).options).toEqual(DEFAULT_OPTIONS);
    expect(() => writePrefs(readPrefs(broken), broken)).not.toThrow();
  });

  it("keeps a dragged owl on screen", () => {
    const viewport = { width: 800, height: 600 };
    expect(clampPosition({ right: -50, bottom: -10 }, viewport, 96)).toEqual({ right: 8, bottom: 8 });
    expect(clampPosition({ right: 5000, bottom: 5000 }, viewport, 96)).toEqual({ right: 696, bottom: 496 });
    expect(clampPosition({ right: 100, bottom: 200 }, viewport, 96)).toEqual({ right: 100, bottom: 200 });
  });
});
