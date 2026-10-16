// Popped-out artifacts: several floating windows, each back at its place
// when Sagax starts again; a docked one does not come back; closing a
// window docks it; the bot's bounds place a window the first time only.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/artifacts", () => ({ setArtifactFlags: vi.fn(async () => ({})) }));

import { createFloatingWindows, FLOATING_STORAGE_KEY } from "@/lib/floating-windows";
import { artifactWindowId, closeArtifactWindow, openArtifactWindow, reconcileArtifactWindows } from "./artifact-windows";
import type { ArtifactSummary } from "../../../shared/artifacts";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}
const viewport = () => ({ width: 1600, height: 1000 });
const summary = (id: string, popped: boolean, extra: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id, botId: "bot-a", title: `Artifact ${id}`, favorite: false, popped, createdAt: 1, updatedAt: 1, rev: 1, refresh: { state: "idle", failures: 0 }, ...extra,
});

describe("artifact windows", () => {
  it("opens several at once, the bot's bounds first, then where the person left it", () => {
    const storage = memoryStorage();
    const manager = createFloatingWindows({ storage, viewport });
    openArtifactWindow({ id: "art_one0001", botId: "bot-a", title: "One", bounds: { x: 100, y: 120, width: 400, height: 300 } }, () => {}, manager);
    openArtifactWindow({ id: "art_two0001", botId: "bot-a", title: "Two" }, () => {}, manager);
    const windows = manager.snapshot().windows;
    expect(windows.map((entry) => entry.id)).toEqual([artifactWindowId("art_one0001"), artifactWindowId("art_two0001")]);
    expect(windows[0]).toMatchObject({ kind: "artifact", persist: true, rect: { x: 100, y: 120, width: 400, height: 300 }, data: { botId: "bot-a", artifactId: "art_one0001" } });
    // the person moves it; reopening keeps their place, not the bot's
    manager.setRect(artifactWindowId("art_one0001"), { x: 700, y: 50, width: 500, height: 360 }, { commit: true });
    closeArtifactWindow("art_one0001", manager);
    openArtifactWindow({ id: "art_one0001", botId: "bot-a", title: "One", bounds: { x: 100, y: 120, width: 400, height: 300 } }, () => {}, manager);
    expect(manager.snapshot().windows.find((entry) => entry.id === artifactWindowId("art_one0001"))?.rect).toEqual({ x: 700, y: 50, width: 500, height: 360 });
  });

  it("comes back at its place after a restart, and reconcile gives it its close handler back", () => {
    const storage = memoryStorage();
    const before = createFloatingWindows({ storage, viewport });
    openArtifactWindow({ id: "art_one0001", botId: "bot-a", title: "One" }, () => {}, before);
    before.setRect(artifactWindowId("art_one0001"), { x: 300, y: 200, width: 450, height: 320 }, { commit: true });
    expect(JSON.parse(storage.data.get(FLOATING_STORAGE_KEY)!).open).toHaveLength(1);

    // Sagax starts again: the window is there before the server answers
    const after = createFloatingWindows({ storage, viewport });
    expect(after.snapshot().windows.map((entry) => [entry.id, entry.rect])).toEqual([[artifactWindowId("art_one0001"), { x: 300, y: 200, width: 450, height: 320 }]]);
    const docked: string[] = [];
    reconcileArtifactWindows([summary("art_one0001", true)], (data) => docked.push(data.artifactId), after);
    after.close(artifactWindowId("art_one0001"));
    expect(docked).toEqual(["art_one0001"]);
  });

  it("closes the window of an artifact the server says is docked or gone, without docking it twice", () => {
    const manager = createFloatingWindows({ storage: memoryStorage(), viewport });
    const docked: string[] = [];
    const onDock = (data: { artifactId: string }) => docked.push(data.artifactId);
    reconcileArtifactWindows([summary("art_one0001", true), summary("art_two0001", true), summary("art_off0001", false)], onDock, manager);
    expect(manager.snapshot().windows.map((entry) => entry.id)).toEqual([artifactWindowId("art_one0001"), artifactWindowId("art_two0001")]);
    // the bot docked one; the other was deleted
    reconcileArtifactWindows([summary("art_one0001", false)], onDock, manager);
    expect(manager.snapshot().windows).toEqual([]);
    expect(docked).toEqual([]);
  });

  it("keeps the stack order when the list comes again, and never reopens a docked one", () => {
    const storage = memoryStorage();
    const manager = createFloatingWindows({ storage, viewport });
    const list = [summary("art_one0001", true), summary("art_two0001", true)];
    reconcileArtifactWindows(list, () => {}, manager);
    manager.focus(artifactWindowId("art_one0001"));
    reconcileArtifactWindows(list, () => {}, manager);
    expect(manager.snapshot().windows.map((entry) => entry.id)).toEqual([artifactWindowId("art_two0001"), artifactWindowId("art_one0001")]);
    // docked by the person: next start it does not come back
    manager.close(artifactWindowId("art_two0001"));
    const restarted = createFloatingWindows({ storage, viewport });
    expect(restarted.snapshot().windows.map((entry) => entry.id)).toEqual([artifactWindowId("art_one0001")]);
  });
});
