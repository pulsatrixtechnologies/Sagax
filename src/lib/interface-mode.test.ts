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

  it("defaults a fresh install to Simple and does not store that", async () => {
    const { readAdvancedMode, readInterfaceMode, INTERFACE_MODE_KEY } = await fresh();
    expect(readInterfaceMode()).toBe("simple");
    expect(readAdvancedMode()).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.getItem(INTERFACE_MODE_KEY)).toBeNull();
    expect((await fresh()).readInterfaceMode()).toBe("simple");
  });

  it("ignores the legacy always-on key", async () => {
    local.setItem("omb-advanced-mode", "1");
    local.setItem("omb-skin", "midnight");
    const { readInterfaceMode, retireLegacyInterfaceMode, LEGACY_ADVANCED_MODE_KEY } = await fresh();
    expect(readInterfaceMode()).toBe("simple");
    retireLegacyInterfaceMode();
    expect(local.getItem(LEGACY_ADVANCED_MODE_KEY)).toBeNull();
    expect(local.getItem("omb-skin")).toBe("midnight");
  });

  it("defaults a solo owner to Simple and an organization owner or admin to Advanced", async () => {
    const { readInterfaceMode, setInterfaceModeRole } = await fresh();
    setInterfaceModeRole({ organization: false, role: "owner" });
    expect(readInterfaceMode()).toBe("simple");
    setInterfaceModeRole({ organization: true, role: "member" });
    expect(readInterfaceMode()).toBe("simple");
    setInterfaceModeRole({ organization: true, role: null });
    expect(readInterfaceMode()).toBe("simple");
    setInterfaceModeRole({ organization: true, role: "owner" });
    expect(readInterfaceMode()).toBe("advanced");
    setInterfaceModeRole({ organization: true, role: "admin" });
    expect(readInterfaceMode()).toBe("advanced");
    expect(local.setItem).not.toHaveBeenCalled();
  });

  it("keeps an explicit choice over the role default", async () => {
    const { setAdvancedMode, INTERFACE_MODE_KEY } = await fresh();
    setAdvancedMode(true);
    expect(local.getItem(INTERFACE_MODE_KEY)).toBe("advanced");
    const next = await fresh();
    next.setInterfaceModeRole({ organization: false, role: null });
    expect(next.readInterfaceMode()).toBe("advanced");
    next.setInterfaceMode("simple");
    const member = await fresh();
    member.setInterfaceModeRole({ organization: true, role: "admin" });
    expect(member.readInterfaceMode()).toBe("simple");
  });

  it("still switches for the session when storage throws", async () => {
    const { setAdvancedMode, readAdvancedMode } = await fresh();
    local.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readAdvancedMode()).toBe(false);
    setAdvancedMode(true);
    expect(readAdvancedMode()).toBe(true);
  });

  it("falls back to Simple when storage cannot be read at all", async () => {
    local.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { readInterfaceMode, retireLegacyInterfaceMode, setInterfaceModeRole } = await fresh();
    expect(() => retireLegacyInterfaceMode()).not.toThrow();
    setInterfaceModeRole({ organization: true, role: "owner" });
    expect(readInterfaceMode()).toBe("simple");
  });

  it("ignores a stored value that is not simple or advanced", async () => {
    local.setItem("sagax.interfaceMode.v1", "1");
    const { readInterfaceMode, setInterfaceModeRole } = await fresh();
    setInterfaceModeRole({ organization: true, role: "member" });
    expect(readInterfaceMode()).toBe("simple");
  });
});
