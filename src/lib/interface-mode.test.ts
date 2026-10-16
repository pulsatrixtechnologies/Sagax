import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: () => values.clear(),
  };
}

let local: ReturnType<typeof memoryStorage>;

// The module keeps a per-session choice, so every case loads a fresh copy
// over the same storage, the way a relaunch would.
async function fresh() {
  vi.resetModules();
  return import("./interface-mode");
}

beforeEach(() => {
  local = memoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("interface mode", () => {
  it("is a per-person preference key", async () => {
    const { INTERFACE_MODE_KEY } = await fresh();
    expect(USER_PREFERENCE_KEYS).toContain(INTERFACE_MODE_KEY);
  });

  it("defaults a fresh install to Advanced and does not store that", async () => {
    const { readAdvancedMode, readInterfaceMode, INTERFACE_MODE_KEY } = await fresh();
    expect(readInterfaceMode()).toBe("advanced");
    expect(readAdvancedMode()).toBe(true);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.getItem(INTERFACE_MODE_KEY)).toBeNull();
    expect((await fresh()).readInterfaceMode()).toBe("advanced");
  });

  it("ignores the legacy always-on key", async () => {
    local.setItem("omb-advanced-mode", "0");
    local.setItem("omb-skin", "midnight");
    const { readInterfaceMode, retireLegacyInterfaceMode, LEGACY_ADVANCED_MODE_KEY } = await fresh();
    expect(readInterfaceMode()).toBe("advanced");
    retireLegacyInterfaceMode();
    expect(local.getItem(LEGACY_ADVANCED_MODE_KEY)).toBeNull();
    expect(local.getItem("omb-skin")).toBe("midnight");
  });

  it("keeps an explicit Simple choice", async () => {
    const { setAdvancedMode, INTERFACE_MODE_KEY } = await fresh();
    setAdvancedMode(false);
    expect(local.getItem(INTERFACE_MODE_KEY)).toBe("simple");
    expect((await fresh()).readInterfaceMode()).toBe("simple");
  });

  it("still switches for the session when storage throws", async () => {
    const { setAdvancedMode, readAdvancedMode } = await fresh();
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readAdvancedMode()).toBe(true);
    setAdvancedMode(false);
    expect(readAdvancedMode()).toBe(false);
  });

  it("falls back to Advanced when storage cannot be read at all", async () => {
    local.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { readInterfaceMode, retireLegacyInterfaceMode, migrateInterfaceModeToAdvancedOnce } = await fresh();
    expect(() => retireLegacyInterfaceMode()).not.toThrow();
    expect(migrateInterfaceModeToAdvancedOnce()).toBe(false);
    expect(readInterfaceMode()).toBe("advanced");
  });

  it("ignores a stored value that is not simple or advanced", async () => {
    local.setItem("sagax.interfaceMode.v1", "1");
    const { readInterfaceMode } = await fresh();
    expect(readInterfaceMode()).toBe("advanced");
  });
});

describe("one-time move to Advanced", () => {
  const at = () => new Date("2026-10-16T14:00:00.000Z");

  it("the marker is a per-person preference key", async () => {
    const { ADVANCED_MODE_MIGRATION_KEY } = await fresh();
    expect(USER_PREFERENCE_KEYS).toContain(ADVANCED_MODE_MIGRATION_KEY);
  });

  it("a new person stays on the Advanced default and gets the marker", async () => {
    const { migrateInterfaceModeToAdvancedOnce, readInterfaceMode, INTERFACE_MODE_KEY, ADVANCED_MODE_MIGRATION_KEY } = await fresh();
    expect(migrateInterfaceModeToAdvancedOnce(undefined, at)).toBe(false);
    expect(readInterfaceMode()).toBe("advanced");
    expect(local.getItem(INTERFACE_MODE_KEY)).toBeNull();
    expect(local.getItem(ADVANCED_MODE_MIGRATION_KEY)).toBe("2026-10-16T14:00:00.000Z");
  });

  it("moves a stored Simple to Advanced and tells the subscribers", async () => {
    local.setItem("sagax.interfaceMode.v1", "simple");
    const mod = await fresh();
    expect(mod.readInterfaceMode()).toBe("simple");
    expect(mod.migrateInterfaceModeToAdvancedOnce(undefined, at)).toBe(true);
    expect(mod.readInterfaceMode()).toBe("advanced");
    expect(local.getItem(mod.INTERFACE_MODE_KEY)).toBe("advanced");
    expect(local.getItem(mod.ADVANCED_MODE_MIGRATION_KEY)).toBe("2026-10-16T14:00:00.000Z");
  });

  it("respects Simple chosen after the move, on every later start", async () => {
    local.setItem("sagax.interfaceMode.v1", "simple");
    const first = await fresh();
    first.migrateInterfaceModeToAdvancedOnce(undefined, at);
    first.setAdvancedMode(false);
    for (let start = 0; start < 3; start += 1) {
      const next = await fresh();
      expect(next.migrateInterfaceModeToAdvancedOnce(undefined, () => new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
      expect(next.readInterfaceMode()).toBe("simple");
    }
    // the marker is written once and never rewritten
    const markerWrites = local.setItem.mock.calls.filter(([key]) => key === first.ADVANCED_MODE_MIGRATION_KEY);
    expect(markerWrites).toEqual([[first.ADVANCED_MODE_MIGRATION_KEY, "2026-10-16T14:00:00.000Z"]]);
  });

  it("leaves Advanced alone and does nothing when the marker came from the organization server", async () => {
    local.setItem("sagax.interfaceMode.v1", "simple");
    local.setItem("sagax.advancedModeMigratedAt.v1", "2026-10-16T13:00:00.000Z");
    const { migrateInterfaceModeToAdvancedOnce, readInterfaceMode } = await fresh();
    local.setItem.mockClear();
    expect(migrateInterfaceModeToAdvancedOnce(undefined, at)).toBe(false);
    expect(readInterfaceMode()).toBe("simple");
    expect(local.setItem).not.toHaveBeenCalled();
  });
});
