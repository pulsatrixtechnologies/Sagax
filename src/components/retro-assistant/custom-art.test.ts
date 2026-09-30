import { describe, expect, it } from "vitest";

import {
  CUSTOM_ART_MAX_BYTES,
  CUSTOM_STATES,
  checkCustomFile,
  clearCustomArt,
  customArtFor,
  customArtReady,
  indexedDbArtStore,
  loadCustomArt,
  saveCustomArt,
  type ArtStore,
  type CustomState,
} from "./custom-art";

function memoryStore(): ArtStore & { map: Map<CustomState, Blob> } {
  const map = new Map<CustomState, Blob>();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => void map.delete(key),
  };
}

const png = (bytes = 8) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("custom assistant pictures", () => {
  it("covers the six moments the assistant shows", () => {
    expect(CUSTOM_STATES).toEqual(["idle", "speak", "think", "sleep", "celebrate", "send"]);
  });

  it("accepts PNG and GIF only, within the size limit", () => {
    expect(checkCustomFile({ type: "image/png", size: 10 })).toBeNull();
    expect(checkCustomFile({ type: "image/gif", size: 10 })).toBeNull();
    expect(checkCustomFile({ type: "image/jpeg", size: 10 })).toBe("type");
    expect(checkCustomFile({ type: "image/svg+xml", size: 10 })).toBe("type");
    expect(checkCustomFile({ type: "image/png", size: 0 })).toBe("size");
    expect(checkCustomFile({ type: "image/png", size: CUSTOM_ART_MAX_BYTES + 1 })).toBe("size");
  });

  it("saves, loads and clears pictures per state, locally", async () => {
    const store = memoryStore();
    expect(await saveCustomArt("idle", png(), store)).toBeNull();
    expect(await saveCustomArt("think", new Blob(["x"], { type: "image/gif" }), store)).toBeNull();
    const art = await loadCustomArt(store);
    expect(Object.keys(art).sort()).toEqual(["idle", "think"]);
    expect(art.idle?.type).toBe("image/png");
    expect(customArtReady(art)).toBe(true);
    await clearCustomArt("idle", store);
    expect(customArtReady(await loadCustomArt(store))).toBe(false);
  });

  it("keeps only the bytes and the type, never a file name", async () => {
    const store = memoryStore();
    const file = new File([new Uint8Array(4)], "C:\\\\Users\\\\jc\\\\secret-name.png", { type: "image/png" });
    await saveCustomArt("speak", file, store);
    const saved = store.map.get("speak");
    expect(saved).toBeInstanceOf(Blob);
    expect(saved).not.toBeInstanceOf(File);
  });

  it("refuses a bad file without touching storage", async () => {
    const store = memoryStore();
    expect(await saveCustomArt("idle", new Blob(["<svg/>"], { type: "image/svg+xml" }), store)).toBe("type");
    expect(store.map.size).toBe(0);
  });

  it("falls back to the resting picture, then to the built-in art", () => {
    const idle = png();
    expect(customArtFor({ idle }, "celebrate")).toBe(idle);
    expect(customArtFor({}, "celebrate")).toBeUndefined();
  });

  it("treats missing or failing storage as no pictures, never as an error", async () => {
    expect(await loadCustomArt(undefined)).toEqual({});
    expect(await saveCustomArt("idle", png(), undefined)).toBe("storage");
    const failing: ArtStore = {
      get: async () => { throw new Error("blocked"); },
      put: async () => { throw new Error("quota"); },
      delete: async () => { throw new Error("blocked"); },
    };
    expect(await loadCustomArt(failing)).toEqual({});
    expect(await saveCustomArt("idle", png(), failing)).toBe("storage");
    await expect(clearCustomArt("idle", failing)).resolves.toBeUndefined();
  });

  it("ignores stored junk that is not a picture", async () => {
    const store = memoryStore();
    store.map.set("idle", new Blob(["x"], { type: "text/html" }));
    expect(await loadCustomArt(store)).toEqual({});
  });

  it("has no IndexedDB store where the context has none", () => {
    expect(indexedDbArtStore(undefined)).toBeUndefined();
  });
});

describe("the IndexedDB store", () => {
  it("turns a database that cannot open into no pictures", async () => {
    const factory = { open: () => { throw new Error("SecurityError"); } } as unknown as IDBFactory;
    const store = indexedDbArtStore(factory);
    expect(store).toBeDefined();
    expect(await loadCustomArt(store)).toEqual({});
    expect(await saveCustomArt("idle", png(), store)).toBe("storage");
  });
});
