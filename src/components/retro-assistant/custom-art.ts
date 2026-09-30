// "Assistant personnalisé": the person's own pictures, one per state, kept in
// this browser's IndexedDB and nowhere else. Nothing here uploads: the files
// are read from a local file picker, stored as Blobs, and shown through
// object URLs. Every storage call is wrapped, so a private window or a
// blocked database simply means "no custom art" instead of an error.

export const CUSTOM_STATES = ["idle", "speak", "think", "sleep", "celebrate", "send"] as const;
export type CustomState = (typeof CUSTOM_STATES)[number];
export type CustomArt = Partial<Record<CustomState, Blob>>;

/** PNG and GIF, as offered; a picture larger than this is refused. */
export const CUSTOM_ART_TYPES = ["image/png", "image/gif"] as const;
export const CUSTOM_ART_MAX_BYTES = 2 * 1024 * 1024;

export type CustomArtProblem = "type" | "size" | "storage";

export function isCustomState(value: unknown): value is CustomState {
  return typeof value === "string" && (CUSTOM_STATES as readonly string[]).includes(value);
}

/** Why a picked file cannot be used, or null when it can. */
export function checkCustomFile(file: Pick<Blob, "type" | "size">): CustomArtProblem | null {
  if (!(CUSTOM_ART_TYPES as readonly string[]).includes(file.type)) return "type";
  if (file.size <= 0 || file.size > CUSTOM_ART_MAX_BYTES) return "size";
  return null;
}

/** The minimal key/value surface the art needs; IndexedDB in the app, a Map in tests. */
export interface ArtStore {
  get(key: CustomState): Promise<Blob | undefined>;
  put(key: CustomState, value: Blob): Promise<void>;
  delete(key: CustomState): Promise<void>;
}

const DB_NAME = "omb-retro98";
const STORE = "custom-assistant";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb request failed"));
  });
}

/** An IndexedDB-backed store, or undefined when this context has none. */
export function indexedDbArtStore(factory: IDBFactory | undefined = globalThis.indexedDB): ArtStore | undefined {
  if (!factory) return undefined;
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      try {
        const open = factory.open(DB_NAME, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error("indexeddb open failed"));
        open.onblocked = () => reject(new Error("indexeddb blocked"));
      } catch (error) {
        reject(error);
      }
    });
    return opened;
  };
  const run = async <T,>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await db();
    return request(act(database.transaction(STORE, mode).objectStore(STORE)));
  };
  return {
    get: async (key) => {
      const value = await run("readonly", (store) => store.get(key));
      return value instanceof Blob ? value : undefined;
    },
    put: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    delete: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}

function defaultStore(): ArtStore | undefined {
  try {
    return indexedDbArtStore();
  } catch {
    return undefined;
  }
}

/** Every saved picture; empty when storage is unavailable or unreadable. */
export async function loadCustomArt(store: ArtStore | undefined = defaultStore()): Promise<CustomArt> {
  const art: CustomArt = {};
  if (!store) return art;
  for (const state of CUSTOM_STATES) {
    try {
      const blob = await store.get(state);
      if (blob && checkCustomFile(blob) === null) art[state] = blob;
    } catch {
      /* one unreadable entry does not hide the others */
    }
  }
  return art;
}

/** Saves one state's picture after checking it; reports why it was refused. */
export async function saveCustomArt(state: CustomState, file: Blob, store: ArtStore | undefined = defaultStore()): Promise<CustomArtProblem | null> {
  if (!isCustomState(state)) return "type";
  const problem = checkCustomFile(file);
  if (problem) return problem;
  if (!store) return "storage";
  try {
    // Keep only the bytes and the type: no file name or path is stored.
    await store.put(state, new Blob([file], { type: file.type }));
    return null;
  } catch {
    return "storage";
  }
}

export async function clearCustomArt(state: CustomState, store: ArtStore | undefined = defaultStore()): Promise<void> {
  if (!store || !isCustomState(state)) return;
  try {
    await store.delete(state);
  } catch {
    /* already gone, or storage is blocked: nothing to show either way */
  }
}

/** The picture for a moment, falling back to the idle one; undefined uses the built-in art. */
export function customArtFor(art: CustomArt, state: CustomState): Blob | undefined {
  return art[state] ?? art.idle;
}

/** Complete enough to wear: at least the idle picture. */
export function customArtReady(art: CustomArt): boolean {
  return Boolean(art.idle);
}
