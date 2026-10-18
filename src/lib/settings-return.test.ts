import { describe, expect, it } from "vitest";

import { SETTINGS_RETURN_KEY, SETTINGS_RETURN_MAX_AGE_MS, rememberSettingsReturn, takeSettingsReturn } from "./settings-return";

function memoryStorage(fail = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => { if (fail) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw new Error("blocked"); data.set(key, value); },
    removeItem: (key: string) => { if (fail) throw new Error("blocked"); data.delete(key); },
  };
}

describe("settings return after a sign-in", () => {
  it("reopens the remembered page once", () => {
    const storage = memoryStorage();
    rememberSettingsReturn("security", storage, 1_000);
    expect(takeSettingsReturn(storage, 2_000)).toBe("security");
    expect(storage.data.has(SETTINGS_RETURN_KEY)).toBe(false);
    expect(takeSettingsReturn(storage, 3_000)).toBeNull();
  });

  it("drops an old, malformed or odd entry", () => {
    const storage = memoryStorage();
    rememberSettingsReturn("security", storage, 0);
    expect(takeSettingsReturn(storage, SETTINGS_RETURN_MAX_AGE_MS + 1)).toBeNull();
    storage.setItem(SETTINGS_RETURN_KEY, "{not json");
    expect(takeSettingsReturn(storage, 0)).toBeNull();
    storage.setItem(SETTINGS_RETURN_KEY, JSON.stringify({ section: "../x", at: 0 }));
    expect(takeSettingsReturn(storage, 0)).toBeNull();
    rememberSettingsReturn("<script>", storage, 0);
    expect(storage.data.has(SETTINGS_RETURN_KEY)).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    const blocked = memoryStorage(true);
    expect(() => rememberSettingsReturn("security", blocked)).not.toThrow();
    expect(takeSettingsReturn(blocked)).toBeNull();
    expect(takeSettingsReturn(null)).toBeNull();
  });
});
