// Artifacts open only in a window of their own (2026-10-28): the desktop app's
// system window (one per artifact, back after a restart without the focus,
// closed when docked, docked when the person closes it), a browser tab where
// there is no desktop app, and never a floating panel inside Sagax. Page
// windows (`page:…`) on the same bridge are not artifacts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/artifacts", () => ({ setArtifactFlags: vi.fn(async () => ({})) }));

import type { ArtifactSummary } from "../../../shared/artifacts";

type Bridge = {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onClosed: ReturnType<typeof vi.fn>;
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
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
  const setArtifactFlags = vi.mocked(artifacts.setArtifactFlags);
  setArtifactFlags.mockClear();
  return { ...windows, floating, setArtifactFlags };
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

describe("opening an artifact", () => {
  it("opens it from the Library in a system window: popped out first, one bridge call, no floating panel", async () => {
    const { openArtifactInOwnWindow, setArtifactFlags, floating } = await load();
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" })).toBe(true);
    expect(setArtifactFlags).toHaveBeenCalledWith("bot-a", "art_one0001", { popped: true });
    expect(setArtifactFlags.mock.invocationCallOrder[0]).toBeLessThan(bridge.open.mock.invocationCallOrder[0]);
    expect(bridge.open).toHaveBeenCalledTimes(1);
    expect(bridge.open).toHaveBeenCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Live table" });
    expect(floating.floatingWindows().snapshot().windows).toEqual([]);
  });

  it("a second Open brings the same window forward, never a second one", async () => {
    const { openArtifactInOwnWindow, setArtifactFlags } = await load();
    // a double click: the second ask waits on the first, no second call
    const both = await Promise.all([
      openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" }),
      openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" }),
    ]);
    expect(both).toEqual([true, true]);
    expect(bridge.open).toHaveBeenCalledTimes(1);
    // later: the desktop app focuses the one it has, nothing is flagged again
    bridge.open.mockResolvedValueOnce("focused");
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table", popped: true })).toBe(true);
    expect(bridge.open).toHaveBeenCalledTimes(2);
    expect(bridge.open).toHaveBeenLastCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Live table" });
    expect(setArtifactFlags).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the desktop app refuses", async () => {
    const { openArtifactInOwnWindow, setArtifactFlags } = await load();
    bridge.open.mockResolvedValueOnce("refused");
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" })).toBe(false);
    expect(setArtifactFlags).toHaveBeenLastCalledWith("bot-a", "art_one0001", { popped: false });
  });

  it("opens the artifact's page in a new browser tab where there is no desktop app", async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("window", { open, innerWidth: 1600, innerHeight: 1000 });
    const { openArtifactInOwnWindow, setArtifactFlags, floating, canOpenArtifactInOwnWindow } = await load();
    expect(canOpenArtifactInOwnWindow()).toBe(false);
    expect(await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "Live table" })).toBe(true);
    expect(open).toHaveBeenCalledWith("/artifact-window#bot=bot-a&artifact=art_one0001", "_blank", "noopener");
    expect(setArtifactFlags).not.toHaveBeenCalled();
    expect(floating.floatingWindows().snapshot().windows).toEqual([]);
  });
});

describe("keeping the system windows matching the server", () => {
  it("opens a popped artifact in its system window without the focus, and no floating panel", async () => {
    const { reconcileArtifactWindows, floating } = await load();
    reconcileArtifactWindows([summary("art_one0001", true), summary("art_off0001", false)]);
    expect(bridge.open).toHaveBeenCalledTimes(1);
    expect(bridge.open).toHaveBeenCalledWith({ botId: "bot-a", artifactId: "art_one0001", title: "Artifact art_one0001", focus: false });
    expect(floating.floatingWindows().snapshot().windows.filter((entry) => entry.kind === "artifact")).toEqual([]);
    // the next list does not ask again
    await new Promise((resolve) => setTimeout(resolve, 0));
    reconcileArtifactWindows([summary("art_one0001", true)]);
    expect(bridge.open).toHaveBeenCalledTimes(1);
  });

  it("closes the window of an artifact docked elsewhere or deleted", async () => {
    const { openArtifactInOwnWindow, reconcileArtifactWindows } = await load();
    await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "One", popped: true });
    await openArtifactInOwnWindow({ id: "art_two0001", botId: "bot-a", title: "Two", popped: true });
    reconcileArtifactWindows([summary("art_one0001", false)]);
    expect(bridge.close.mock.calls).toEqual([["art_one0001"], ["art_two0001"]]);
  });

  it("docks one whose window the person closed, and a stale list does not reopen it", async () => {
    const { openArtifactInOwnWindow, reconcileArtifactWindows, ownArtifactWindowClosed, setArtifactFlags } = await load();
    await openArtifactInOwnWindow({ id: "art_one0001", botId: "bot-a", title: "One", popped: true });
    ownArtifactWindowClosed({ botId: "bot-a", artifactId: "art_one0001" });
    expect(setArtifactFlags).toHaveBeenLastCalledWith("bot-a", "art_one0001", { popped: false });
    bridge.open.mockClear();
    reconcileArtifactWindows([summary("art_one0001", true)]);
    expect(bridge.open).not.toHaveBeenCalled();
    // docked for good, then the bot pops it out again: its window comes back
    reconcileArtifactWindows([summary("art_one0001", false)]);
    reconcileArtifactWindows([summary("art_one0001", true)]);
    expect(bridge.open).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "art_one0001", focus: false }));
  });
});

describe("page windows on the same bridge", () => {
  it("tells a page window id from an artifact's", async () => {
    const { isPageWindowId } = await load();
    expect(isPageWindowId("page:abc123")).toBe(true);
    expect(isPageWindowId("art_one0001")).toBe(false);
    expect(isPageWindowId("artifact:page:x")).toBe(false);
  });

  it("never docks, opens or closes a page window", async () => {
    const { ownArtifactWindowClosed, reconcileArtifactWindows, setArtifactFlags } = await load();
    ownArtifactWindowClosed({ botId: "bot-a", artifactId: "page:abc123" });
    expect(setArtifactFlags).not.toHaveBeenCalled();
    reconcileArtifactWindows([summary("page:abc123", true)]);
    reconcileArtifactWindows([]);
    expect(bridge.open).not.toHaveBeenCalled();
    expect(bridge.close).not.toHaveBeenCalled();
  });
});

describe("migrating from the floating panels", () => {
  it("drops the restored artifact panels and their places, keeps the terminal's, erases the old list, and the system window opens instead", async () => {
    const { migrateLegacyArtifactPanels, reconcileArtifactWindows, LEGACY_OWN_WINDOWS_STORAGE_KEY, floating } = await load();
    const saved = memoryStorage({
      [floating.FLOATING_STORAGE_KEY]: JSON.stringify({
        open: [
          { id: "artifact:art_one0001", kind: "artifact", title: "One", data: { botId: "bot-a", artifactId: "art_one0001" }, rect: { x: 10, y: 10, width: 400, height: 300 }, minWidth: 240, minHeight: 160, contain: true },
          { id: "terminal:t1", kind: "terminal", title: "T", rect: { x: 50, y: 50, width: 400, height: 300 }, minWidth: 240, minHeight: 160 },
        ],
        geometry: { "artifact:art_one0001": { x: 10, y: 10, width: 400, height: 300 }, "terminal:t1": { x: 50, y: 50, width: 400, height: 300 } },
      }),
      [LEGACY_OWN_WINDOWS_STORAGE_KEY]: JSON.stringify(["art_two0001"]),
    });
    const manager = floating.createFloatingWindows({ storage: saved, viewport });
    expect(manager.snapshot().windows.map((entry) => entry.kind)).toEqual(["artifact", "terminal"]);
    migrateLegacyArtifactPanels(manager, saved);
    expect(manager.snapshot().windows.map((entry) => entry.id)).toEqual(["terminal:t1"]);
    const after = JSON.parse(saved.data.get(floating.FLOATING_STORAGE_KEY)!);
    expect(Object.keys(after.geometry)).toEqual(["terminal:t1"]);
    expect(saved.data.has(LEGACY_OWN_WINDOWS_STORAGE_KEY)).toBe(false);
    // the server still says popped: it opens in its system window, quietly
    reconcileArtifactWindows([summary("art_one0001", true), summary("art_two0001", true)]);
    expect(bridge.open.mock.calls.map(([request]) => [request.artifactId, request.focus])).toEqual([["art_one0001", false], ["art_two0001", false]]);
    expect(manager.snapshot().windows.filter((entry) => entry.kind === "artifact")).toEqual([]);
  });
});
