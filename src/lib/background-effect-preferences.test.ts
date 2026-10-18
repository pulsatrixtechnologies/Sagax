import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ subscribe: undefined as undefined | ((listener: () => void) => () => void) }));

vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => unknown) => {
    hook.subscribe = subscribe;
    return snapshot();
  },
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;
let browser: EventTarget;

beforeEach(() => {
  vi.resetModules();
  local = memoryStorage();
  browser = new EventTarget();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", browser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("background effect preference (Settings > Appearance)", () => {
  it("defaults to None and writes nothing on read", async () => {
    const prefs = await import("./background-effect-preferences");
    expect(prefs.readBackgroundEffectPrefs()).toEqual({ effect: "none", palettes: {}, intensity: "medium" });
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("migrates the old glyph ripple switch: on is Glyph ripple, anything else None", async () => {
    const prefs = await import("./background-effect-preferences");
    local.setItem(prefs.GLYPH_RIPPLE_KEY, "1");
    expect(prefs.readBackgroundEffectPrefs().effect).toBe("glyphs");
    for (const value of ["0", "", "true", "broken"]) {
      local.setItem(prefs.GLYPH_RIPPLE_KEY, value);
      expect(prefs.readBackgroundEffectPrefs().effect).toBe("none");
    }
    // the new key wins over the old switch, and the first write drops it
    local.setItem(prefs.GLYPH_RIPPLE_KEY, "1");
    prefs.setBackgroundEffect("aurora");
    expect(local.removeItem).toHaveBeenCalledWith(prefs.GLYPH_RIPPLE_KEY);
    expect(JSON.parse(local.getItem(prefs.BACKGROUND_EFFECT_KEY)!)).toMatchObject({ effect: "aurora" });
  });

  it("parses whatever storage holds, field by field", async () => {
    const { parsePrefs } = await import("./background-effect-preferences");
    expect(parsePrefs("{oops")).toEqual({ effect: "none", palettes: {}, intensity: "medium" });
    expect(parsePrefs(JSON.stringify({ effect: "sonar", palettes: { sonar: "ember", glyphs: "nope", bogus: "ocean" }, intensity: "high" }))).toEqual({
      effect: "sonar",
      palettes: { sonar: "ember" },
      intensity: "high",
    });
    expect(parsePrefs(JSON.stringify({ effect: "lava", intensity: 3 }))).toEqual({ effect: "none", palettes: {}, intensity: "medium" });
    expect(parsePrefs("[]")).toEqual({ effect: "none", palettes: {}, intensity: "medium" });
  });

  it("keeps a colour per effect and the intensity, and returns the same object until a change", async () => {
    const prefs = await import("./background-effect-preferences");
    prefs.setBackgroundPalette("matrix", "neon");
    prefs.setBackgroundPalette("aurora", "violet");
    prefs.setBackgroundIntensity("low");
    const first = prefs.readBackgroundEffectPrefs();
    expect(first).toEqual({ effect: "aurora", palettes: { matrix: "neon", aurora: "violet" }, intensity: "low" });
    expect(prefs.readBackgroundEffectPrefs()).toBe(first);
  });

  it("follows another window through the storage event", async () => {
    const prefs = await import("./background-effect-preferences");
    prefs.setBackgroundEffect("crystal");
    expect(prefs.useBackgroundEffectPrefs().effect).toBe("crystal");
    const listener = vi.fn();
    const unsubscribe = hook.subscribe!(listener);
    local.setItem(prefs.BACKGROUND_EFFECT_KEY, JSON.stringify({ effect: "fireflies" }));
    // another storage area or an unrelated key changes nothing
    browser.dispatchEvent(Object.assign(new Event("storage"), { key: "other", storageArea: local }));
    browser.dispatchEvent(Object.assign(new Event("storage"), { key: prefs.BACKGROUND_EFFECT_KEY, storageArea: {} }));
    expect(listener).not.toHaveBeenCalled();
    expect(prefs.readBackgroundEffectPrefs().effect).toBe("crystal");
    browser.dispatchEvent(Object.assign(new Event("storage"), { key: prefs.BACKGROUND_EFFECT_KEY, storageArea: local }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prefs.readBackgroundEffectPrefs().effect).toBe("fireflies");
    unsubscribe();
  });

  it("keeps the session choice when storage throws", async () => {
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    const prefs = await import("./background-effect-preferences");
    prefs.setBackgroundEffect("bubbles");
    expect(prefs.readBackgroundEffectPrefs().effect).toBe("bubbles");
  });
});
