import { describe, expect, it } from "vitest";

import { clampRect, createFloatingWindows, FLOATING_STORAGE_KEY, MAX_FLOATING_WINDOWS, readSaved, type FloatingStorage } from "./floating-windows";

function memoryStorage(initial?: unknown): FloatingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(FLOATING_STORAGE_KEY, JSON.stringify(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}
const viewport = () => ({ width: 1440, height: 900 });

describe("floating windows", () => {
  it("opens several at once, stacked with an offset, the last one on top", () => {
    const windows = createFloatingWindows({ storage: memoryStorage(), viewport });
    windows.open({ id: "terminal:a", kind: "terminal", title: "A", size: { width: 600, height: 400 } });
    windows.open({ id: "terminal:b", kind: "terminal", title: "B", size: { width: 600, height: 400 } });
    const [a, b] = windows.snapshot().windows;
    expect([a.id, b.id]).toEqual(["terminal:a", "terminal:b"]);
    expect(b.rect.x - a.rect.x).toBe(28);
    expect(b.rect.y - a.rect.y).toBe(28);
  });

  it("brings a window forward on focus and closes each on its own", () => {
    const windows = createFloatingWindows({ storage: memoryStorage(), viewport });
    let closed = 0;
    windows.open({ id: "a", kind: "k", title: "A", onClose: () => closed++ });
    windows.open({ id: "b", kind: "k", title: "B" });
    windows.focus("a");
    expect(windows.snapshot().windows.map((entry) => entry.id)).toEqual(["b", "a"]);
    windows.close("a");
    expect(closed).toBe(1);
    expect(windows.snapshot().windows.map((entry) => entry.id)).toEqual(["b"]);
    windows.close("a");
    expect(closed).toBe(1);
  });

  it("opening an open id focuses it instead of adding a second window", () => {
    const windows = createFloatingWindows({ storage: memoryStorage(), viewport });
    windows.open({ id: "a", kind: "k", title: "A" });
    windows.open({ id: "b", kind: "k", title: "B" });
    windows.open({ id: "a", kind: "k", title: "A2" });
    expect(windows.snapshot().windows.map((entry) => `${entry.id}:${entry.title}`)).toEqual(["b:B", "a:A2"]);
  });

  it("remembers position and size per id and reopens there", () => {
    const storage = memoryStorage();
    const windows = createFloatingWindows({ storage, viewport });
    windows.open({ id: "a", kind: "k", title: "A" });
    windows.setRect("a", { x: 100, y: 120, width: 500, height: 300 }, { commit: true });
    windows.close("a");
    windows.open({ id: "a", kind: "k", title: "A" });
    expect(windows.snapshot().windows[0].rect).toEqual({ x: 100, y: 120, width: 500, height: 300 });
    // and after a restart
    const later = createFloatingWindows({ storage, viewport });
    later.open({ id: "a", kind: "k", title: "A" });
    expect(later.snapshot().windows[0].rect).toEqual({ x: 100, y: 120, width: 500, height: 300 });
  });

  it("a live drag moves the window without saving until it ends", () => {
    const storage = memoryStorage();
    const windows = createFloatingWindows({ storage, viewport });
    windows.open({ id: "a", kind: "k", title: "A" });
    windows.setRect("a", { x: 10, y: 10, width: 500, height: 300 });
    expect(windows.snapshot().windows[0].rect.x).toBe(10);
    expect(windows.rememberedRect("a")).toBeUndefined();
  });

  it("reopens persistent windows after a restart, drawn once their kind is registered", () => {
    const storage = memoryStorage();
    const windows = createFloatingWindows({ storage, viewport });
    windows.open({ id: "artifact:1", kind: "artifact", title: "Rapport", data: { url: "x" }, persist: true });
    windows.open({ id: "terminal:s", kind: "terminal", title: "Shell", render: () => "shell" });
    windows.setRect("artifact:1", { x: 50, y: 60, width: 400, height: 300 }, { commit: true });

    const restarted = createFloatingWindows({ storage, viewport });
    const [restored] = restarted.snapshot().windows;
    expect(restarted.snapshot().windows).toHaveLength(1);
    expect(restored).toMatchObject({ id: "artifact:1", kind: "artifact", title: "Rapport", data: { url: "x" }, rect: { x: 50, y: 60, width: 400, height: 300 }, persist: true });
    expect(restarted.hasRenderer(restored)).toBe(false);
    restarted.registerKind("artifact", (entry) => `drawn ${(entry.data as { url: string }).url}`);
    expect(restarted.hasRenderer(restored)).toBe(true);
    expect(restarted.renderBody(restored)).toBe("drawn x");
  });

  it("caps the open windows, closing the bottom one", () => {
    const windows = createFloatingWindows({ storage: memoryStorage(), viewport });
    const closed: string[] = [];
    for (let i = 0; i <= MAX_FLOATING_WINDOWS; i++) windows.open({ id: `w${i}`, kind: "k", title: `${i}`, onClose: () => closed.push(`w${i}`) });
    expect(windows.snapshot().windows).toHaveLength(MAX_FLOATING_WINDOWS);
    expect(closed).toEqual(["w0"]);
  });

  it("keeps a window reachable in a smaller viewport", () => {
    expect(clampRect({ x: 2000, y: -50, width: 3000, height: 400 }, { width: 800, height: 600 })).toEqual({ x: 704, y: 0, width: 800, height: 400 });
    expect(clampRect({ x: -900, y: 900, width: 500, height: 300 }, { width: 800, height: 600 })).toEqual({ x: -404, y: 564, width: 500, height: 300 });
  });

  it("ignores malformed saved data", () => {
    expect(readSaved(memoryStorage({ open: [{ id: "a" }, { id: "b c", kind: "k", title: "x", rect: { x: 0, y: 0, width: 1, height: 1 } }, 3], geometry: { a: { x: "1" } } }))).toEqual({ open: [], geometry: {} });
    const broken = memoryStorage();
    broken.data.set(FLOATING_STORAGE_KEY, "{not json");
    expect(readSaved(broken)).toEqual({ open: [], geometry: {} });
  });
});
