import { describe, expect, it, vi } from "vitest";

import { answerDeviceRequest, createDeviceSettingsAnswerer, type DeviceEnv } from "./device-settings";

function env(over: Partial<DeviceEnv> = {}): DeviceEnv & { stored: Map<string, string>; preferred: { id: string | null } } {
  const stored = new Map<string, string>([["omb-skin", "night"]]);
  const preferred = { id: null as string | null };
  return {
    stored,
    preferred,
    ogb: undefined,
    storage: { getItem: (key: string) => stored.get(key) ?? null },
    isPreferenceKey: (key) => key === "omb-skin",
    applyPreference: (key, value) => { stored.set(key, value); },
    audioInputs: async () => [{ id: "mic-1", label: "USB Mic" }],
    preferredAudioInput: () => preferred.id ?? undefined,
    setPreferredAudioInput: (id) => { preferred.id = id; },
    ...over,
  };
}

describe("device settings in the person's open app (#1545)", () => {
  it("reads and writes a preference where Settings keeps it", async () => {
    const e = env();
    expect(await answerDeviceRequest({ op: "get", key: "omb-skin" }, e)).toEqual({ device: "web", value: "night" });
    expect(await answerDeviceRequest({ op: "set", key: "omb-skin", value: "day" }, e)).toEqual({ device: "web", value: "day" });
    expect(e.stored.get("omb-skin")).toBe("day");
  });

  it("answers unsupported for what this app does not keep (a desktop setting in a tab, an iPhone setting)", async () => {
    expect(await answerDeviceRequest({ op: "get", key: "device.openAtLogin" }, env())).toEqual({ device: "web", unsupported: true });
    const desktop = env({ ogb: { openAtLogin: { get: async () => ({ choice: "on", platform: "darwin" }), set: async (c: "on" | "off") => ({ choice: c, platform: "darwin" }) } } as unknown as DeviceEnv["ogb"] });
    expect(await answerDeviceRequest({ op: "get", key: "device.haptics" }, desktop)).toEqual({ device: "desktop", unsupported: true });
  });

  it("opens at login through the desktop bridge", async () => {
    const set = vi.fn(async (choice: "on" | "off") => ({ choice, platform: "darwin" }));
    const e = env({ ogb: { openAtLogin: { get: async () => ({ choice: "unset", platform: "darwin" }), set } } as unknown as DeviceEnv["ogb"] });
    expect(await answerDeviceRequest({ op: "get", key: "device.openAtLogin" }, e)).toEqual({ device: "desktop", value: "unset" });
    expect(await answerDeviceRequest({ op: "set", key: "device.openAtLogin", value: "on" }, e)).toEqual({ device: "desktop", value: "on" });
    expect(set).toHaveBeenCalledWith("on");
    expect(await answerDeviceRequest({ op: "set", key: "device.openAtLogin", value: "maybe" }, e)).toMatchObject({ error: expect.stringMatching(/on or off/) });
  });

  it("changes the update channel and reads it from the updater's state", async () => {
    const updater = {
      onState: (cb: (s: unknown) => void) => { cb({ status: "idle", channel: "stable" }); return () => {}; },
      setChannel: vi.fn(async (channel: string) => ({ status: "idle", channel })),
    };
    const e = env({ ogb: { updater } as unknown as DeviceEnv["ogb"] });
    expect(await answerDeviceRequest({ op: "get", key: "device.updateChannel" }, e)).toEqual({ device: "desktop", value: "stable" });
    expect(await answerDeviceRequest({ op: "set", key: "device.updateChannel", value: "nightly" }, e)).toEqual({ device: "desktop", value: "nightly" });
  });

  it("picks a microphone by name, lists them, and goes back to the default", async () => {
    const e = env();
    expect(await answerDeviceRequest({ op: "set", key: "device.microphone", value: "usb mic" }, e)).toEqual({ device: "web", value: JSON.stringify({ selected: "mic-1", inputs: [{ id: "mic-1", label: "USB Mic" }] }) });
    expect(await answerDeviceRequest({ op: "set", key: "device.microphone", value: "nope" }, e)).toMatchObject({ error: expect.stringMatching(/No such microphone/) });
    expect(JSON.parse(String((await answerDeviceRequest({ op: "set", key: "device.microphone", value: "default" }, e)).value)).selected).toBe("default");
  });

  it("never gives the pairing code: only whether pairing is open", async () => {
    const companion = {
      state: async () => ({ enabled: true, devices: [{ id: "d1", name: "iPhone", lastSeenAt: 5 }], pairing: { code: "123456", token: "secret", expiresAt: 9 } }),
      start: vi.fn(), stop: vi.fn(), pairing: vi.fn(async () => ({ pairing: null })), revoke: vi.fn(),
    };
    const e = env({ ogb: { companion } as unknown as DeviceEnv["ogb"] });
    const pairing = await answerDeviceRequest({ op: "set", key: "device.pairing", value: "true" }, e);
    expect(companion.pairing).toHaveBeenCalledWith(true);
    expect(pairing).toEqual({ device: "desktop", value: JSON.stringify({ open: true, expiresAt: 9 }) });
    expect(JSON.stringify(pairing)).not.toMatch(/123456|secret/);
    expect(await answerDeviceRequest({ op: "get", key: "device.remoteAccess" }, e)).toEqual({ device: "desktop", value: JSON.stringify({ enabled: true, devices: [{ id: "d1", name: "iPhone", lastSeenAt: 5 }] }) });
    await answerDeviceRequest({ op: "set", key: "device.pairedDeviceRemove", value: "d1" }, e);
    expect(companion.revoke).toHaveBeenCalledWith("d1");
  });

  it("changes a shared folder or the terminal, never adds a folder the person did not choose", async () => {
    const save = vi.fn(async (_id: string, grant: unknown) => grant);
    const ogb = {
      environments: { state: async () => ({ environments: [{ id: "local", kind: "local", name: "This Mac" }, { id: "s1", kind: "remote", name: "Work" }] }) },
      computerSharing: {
        state: async () => ({ enabled: true, connected: true, terminal: true, computer: false, folders: [{ id: "f1", name: "Docs", path: "/Users/a/Docs", write: false }] }),
        save, revoke: vi.fn(async () => ({})),
      },
    } as unknown as DeviceEnv["ogb"];
    const e = env({ ogb });
    await answerDeviceRequest({ op: "set", key: "device.computerSharing", value: JSON.stringify({ server: "s1", terminal: false, folders: [{ path: "/Users/a/Docs", write: true }] }) }, e);
    expect(save).toHaveBeenCalledWith("s1", { folders: [{ id: "f1", name: "Docs", path: "/Users/a/Docs", write: true }], terminal: false, computer: false });
    expect(await answerDeviceRequest({ op: "set", key: "device.computerSharing", value: JSON.stringify({ server: "s1", folders: [{ path: "/etc", write: true }] }) }, e)).toMatchObject({ error: expect.stringMatching(/Choose a folder/) });
    const listed = JSON.parse(String((await answerDeviceRequest({ op: "get", key: "device.computerSharing" }, e)).value));
    expect(listed).toEqual([{ server: "s1", name: "Work", enabled: true, connected: true, terminal: true, computer: false, folders: [{ name: "Docs", path: "/Users/a/Docs", write: false }] }]);
  });

  it("fetches the waiting requests on the frame and answers each once", async () => {
    const posts: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ requests: [{ id: "r1", op: "get", key: "omb-skin", botName: "Wren", at: 1 }] }), { status: 200 });
      posts.push([url, JSON.parse(String(init.body))]);
      return new Response("{}", { status: 200 });
    });
    const answerer = createDeviceSettingsAnswerer({ fetch: fetchMock as unknown as typeof fetch, env: () => env() });
    await answerer.receive();
    await answerer.receive();
    expect(posts).toEqual([["/api/me/device-settings/requests/r1", { device: "web", value: "night" }]]);
  });

  it("exports the vault to a file on this device and runs the key ceremonies here: the bot hears only that it is done (#1545)", async () => {
    const exportVault = vi.fn(async () => 3);
    const addSecurityKey = vi.fn(async () => {});
    const setSecurityKeyClasses = vi.fn(async () => {});
    const e = env({ exportVault, addSecurityKey, setSecurityKeyClasses, removeSecurityKey: async () => {} });
    expect(await answerDeviceRequest({ op: "set", key: "device.vaultExport", value: "bitwarden-json" }, e)).toEqual({ device: "web", value: "saved on this device: 3 item(s)" });
    expect(exportVault).toHaveBeenCalledWith("bitwarden-json");
    expect(await answerDeviceRequest({ op: "set", key: "device.securityKeyAdd", value: "Blue" }, e)).toEqual({ device: "web", value: "added" });
    expect(await answerDeviceRequest({ op: "set", key: "device.securityKeyClasses", value: JSON.stringify(["destructive"]) }, e)).toEqual({ device: "web", value: "saved" });
    expect(setSecurityKeyClasses).toHaveBeenCalledWith(["destructive"]);
    expect(await answerDeviceRequest({ op: "get", key: "device.vaultExport" }, e)).toEqual({ device: "web", unsupported: true });
  });

  it("says a ceremony started when the person still has to touch their key", async () => {
    vi.useFakeTimers();
    try {
      const e = env({ removeSecurityKey: () => new Promise<void>(() => {}) });
      const answer = answerDeviceRequest({ op: "set", key: "device.securityKeyRemove", value: "k1" }, e);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(await answer).toMatchObject({ device: "web", value: expect.stringMatching(/^started/) });
    } finally {
      vi.useRealTimers();
    }
  });
});
