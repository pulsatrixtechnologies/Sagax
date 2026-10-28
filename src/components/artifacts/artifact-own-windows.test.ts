// Artifacts in a real window of their own (desktop app, electron/artifact-window.mjs):
// opened from the Library or by dragging the floating panel out of the app,
// one per artifact, back in their own window after a restart (without taking
// the focus), closed when the artifact is docked, and docked when the person
// closes the window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/artifacts", () => ({ setArtifactFlags: vi.fn(async () => ({})) }));

import type { ArtifactSummary } from "../../../shared/artifacts";

type Bridge = {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onClosed: ReturnType<typeof vi.fn>;
};

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}
const viewport = () => ({ width: 1600, height: 1000 });
const summary = (id: string, popped: boolean): ArtifactSummary => ({
  id, botId: "bot-a", title: `Artifact ${id}`, favorite: false, popped, createdAt: 1, updatedAt: 1, rev: 1, refresh: { state: "idle", failures: 0 },
});

let storage: ReturnType<typeof memoryStorage>;
let bridge: Bridge;

async function load() {
  vi.resetModules();
  const windows = await import("./artifact-windows");
  const floating = await import("@/lib/floating-windows");
  const artifacts = await import("@/lib/artifacts");
  return { ...windows, floating, setArtifactFlags: vi.mocked(artifacts.setArtifactFlags) };
}

beforeEach(() => {
  storage = memoryStorage();
  bridge = { open: vi.fn(async () => "created"), close: vi.fn(async () => true), onClosed: vi.fn(() => () => {}) };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { ogb: { artifactWindow: bridge }, innerWidth: 1600, innerHeight: 1000 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artifacts in a window of their own", () => {
  it("opens one from the Library: popped out first, then a real window, and remembered", async () => {
    const { openArtifactInOwnWindow, OWN_WINDOWS_STORAGE_KEY, setArtifactFlags } = await load();
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" })).toBe(true);
    expect(setArtifactFlags).toHaveBeenCalledWith("bot-a", "art_one0001", { popped: true });
    expect(setArtifactFlags.mock.invocationCallOrder[0]).toBeLessThan(bridge.open.mock.invocationCallOrder[0]);
    expect(bridge.open).toHaveBeenCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Live table" });
    expect(JSON.parse(storage.data.get(OWN_WINDOWS_STORAGE_KEY)!)).toEqual(["art_one0001"]);
  });

  it("changes nothing when the desktop app refuses", async () => {
    const { openArtifactInOwnWindow, artifactHasOwnWindow, setArtifactFlags } = await load();
    bridge.open.mockResolvedValueOnce("refused");
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" })).toBe(false);
    expect(artifactHasOwnWindow("art_one0001")).toBe(false);
    expect(setArtifactFlags).toHaveBeenLastCalledWith("bot-a", "art_one0001", { popped: false });
  });

  it("leaves the floating panel for a real window when its title bar is let go outside the app", async () => {
    const { openArtifactWindow, artifactWindowId, floating } = await load();
    const manager = floating.createFloatingWindows({ storage: memoryStorage(), viewport });
    openArtifactWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" }, () => {}, manager);
    const id = artifactWindowId("art_one0001");
    expect(manager.snapshot().windows[0]).toMatchObject({ contain: true });
    expect(manager.detachable(id)).toBe(true);
    manager.detach(id, { x: 2000, y: 300 });
    await vi.waitFor(() => expect(bridge.open).toHaveBeenCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Live table", x: 2000, y: 300 }));
  });

  it("is not detachable where there is no desktop app", async () => {
    vi.stubGlobal("window", { innerWidth: 1600, innerHeight: 1000 });
    const { openArtifactWindow, artifactWindowId, floating } = await load();
    const manager = floating.createFloatingWindows({ storage: memoryStorage(), viewport });
    openArtifactWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" }, () => {}, manager);
    expect(manager.detachable(artifactWindowId("art_one0001"))).toBe(false);
  });

  it("comes back in its own window after a restart, without the focus and without a floating panel", async () => {
    const first = await load();
    await first.openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table", popped: true });
    bridge.open.mockClear();

    const after = await load();
    const manager = after.floating.createFloatingWindows({ storage: memoryStorage(), viewport });
    after.reconcileArtifactWindows([summary("art_one0001", true)], () => {}, manager);
    expect(bridge.open).toHaveBeenCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Artifact art_one0001", focus: false });
    expect(manager.snapshot().windows).toEqual([]);
    // the next list does not ask again
    await vi.waitFor(() => expect(after.artifactHasOwnWindow("art_one0001")).toBe(true));
    after.reconcileArtifactWindows([summary("art_one0001", true)], () => {}, manager);
    expect(bridge.open).toHaveBeenCalledTimes(1);
  });

  it("closes the window of an artifact docked elsewhere, and docks one whose window the person closed", async () => {
    const { openArtifactInOwnWindow, reconcileArtifactWindows, ownArtifactWindowClosed, floating, setArtifactFlags } = await load();
    const manager = floating.createFloatingWindows({ storage: memoryStorage(), viewport });
    await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "One", popped: true });
    await openArtifactInOwnWindow({ id: "art_two0001", botId: "bot-a", title: "Two", popped: true });
    reconcileArtifactWindows([summary("art_one0001", false), summary("art_two0001", true)], () => {}, manager);
    expect(bridge.close).toHaveBeenCalledWith("art_one0001");
    expect(manager.snapshot().windows).toEqual([]);
    ownArtifactWindowClosed({ botId: "bot-a", artifactId: "art_two0001" });
    expect(setArtifactFlags).toHaveBeenLastCalledWith("bot-a", "art_two0001", { popped: false });
  });
});
