import { afterEach, describe, expect, it, vi } from "vitest";

function capabilities(status: "checking" | "ready"): DesktopCapabilities {
  return {
    host: {
      platform: "linux",
      label: "Ubuntu",
      session: "x11",
      packaged: true,
    },
    windowChrome: "native",
    screenPreview: {
      available: true,
      interaction: "direct",
    },
    dictation: {
      available: false,
      engine: "none",
      onDevice: false,
      reasonCode: "unsupported-platform",
    },
    localComputer: {
      available: status === "ready",
      support: "limited",
      enabled: true,
      status,
      reasonCode: status === "checking" ? "checking-driver" : undefined,
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("desktop capability cache", () => {
  it("does not let an older initial query replace a newer IPC update", async () => {
    let resolveInitial!: (value: DesktopCapabilities) => void;
    const initial = new Promise<DesktopCapabilities>((resolve) => {
      resolveInitial = resolve;
    });
    vi.stubGlobal("window", {
      ogb: {
        platform: "linux",
        getCapabilities: () => initial,
      },
    });
    const desktop = await import("./desktop");
    const pending = desktop.loadDesktopCapabilities();
    const ready = capabilities("ready");

    desktop.cacheDesktopCapabilities(ready);
    resolveInitial(capabilities("checking"));

    await expect(pending).resolves.toBe(ready);
    await expect(desktop.loadDesktopCapabilities()).resolves.toBe(ready);
  });
});

describe("servedPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a server's page in a browser and in the desktop app showing a server, never the desktop's local page", async () => {
    const { servedPage } = await import("./desktop");
    vi.stubGlobal("window", {});
    expect(servedPage()).toBe(true);
    // this app's bundle drawn on an organization server: no remoteClient
    vi.stubGlobal("window", { ogb: { platform: "darwin", floatingBots: {} } });
    expect(servedPage()).toBe(true);
    vi.stubGlobal("window", { ogb: { platform: "darwin", remoteClient: { active: false } } });
    expect(servedPage()).toBe(false);
    vi.stubGlobal("window", { ogb: { platform: "darwin", remoteClient: { active: true } } });
    expect(servedPage()).toBe(false);
  });
});
