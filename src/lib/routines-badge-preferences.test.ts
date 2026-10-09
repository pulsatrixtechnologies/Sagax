import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

describe("routines badge preference", () => {
  it("is off until the switch is turned on, and persists the choice", async () => {
    const mod = await import("./routines-badge-preferences");
    expect(localStorage.getItem(mod.ROUTINES_BADGE_KEY)).toBeNull();
    mod.setShowRoutinesBadge(true);
    expect(localStorage.getItem(mod.ROUTINES_BADGE_KEY)).toBe("1");
    mod.setShowRoutinesBadge(false);
    expect(localStorage.getItem(mod.ROUTINES_BADGE_KEY)).toBe("0");
  });
});
