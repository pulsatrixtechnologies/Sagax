import { describe, expect, it } from "vitest";

import { OPEN_THREAD_MAX_AGE_MS, OPEN_THREAD_STORAGE_KEY, openThreadVisible, parseOpenThreadHash, rememberOpenThreadHash, takeOpenThreadTarget } from "./open-thread-hash";

function memoryStorage(fail = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => { if (fail) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fail) throw new Error("blocked"); data.set(key, value); },
    removeItem: (key: string) => { if (fail) throw new Error("blocked"); data.delete(key); },
  };
}

describe("open thread hash", () => {
  it("parses #thread=<id>&bot=<id> and nothing else", () => {
    expect(parseOpenThreadHash("#thread=t-1&bot=b_2")).toEqual({ threadId: "t-1", botId: "b_2" });
    expect(parseOpenThreadHash("bot=b&thread=t")).toEqual({ threadId: "t", botId: "b" });
    expect(parseOpenThreadHash("#thread=t")).toBeNull();
    expect(parseOpenThreadHash("#thread=t&bot=b&x=1")).toBeNull();
    expect(parseOpenThreadHash("#thread=../x&bot=b")).toBeNull();
    expect(parseOpenThreadHash(`#thread=${"a".repeat(129)}&bot=b`)).toBeNull();
    expect(parseOpenThreadHash("#routine-delegation=ok")).toBeNull();
    expect(parseOpenThreadHash("")).toBeNull();
  });

  it("keeps the link through a sign-in, then takes it once", () => {
    const storage = memoryStorage();
    expect(rememberOpenThreadHash("#thread=t&bot=b", storage, 1000)).toEqual({ threadId: "t", botId: "b" });
    expect(storage.data.has(OPEN_THREAD_STORAGE_KEY)).toBe(true);
    // back on "/" after the sign-in: no hash, the kept link
    const replaced: string[] = [];
    const history = { replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)); } };
    expect(takeOpenThreadTarget({ hash: "", pathname: "/", search: "" }, history, storage, 2000)).toEqual({ threadId: "t", botId: "b" });
    expect(replaced).toEqual([]);
    expect(takeOpenThreadTarget({ hash: "", pathname: "/", search: "" }, history, storage, 2000)).toBeNull();
  });

  it("prefers the address, clears it, and drops a stale or malformed kept link", () => {
    const storage = memoryStorage();
    storage.setItem(OPEN_THREAD_STORAGE_KEY, JSON.stringify({ threadId: "old", botId: "b", at: 0 }));
    const replaced: string[] = [];
    const history = { replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)); } };
    expect(takeOpenThreadTarget({ hash: "#thread=new&bot=b", pathname: "/", search: "?x=1" }, history, storage, 5)).toEqual({ threadId: "new", botId: "b" });
    expect(replaced).toEqual(["/?x=1"]);
    storage.setItem(OPEN_THREAD_STORAGE_KEY, JSON.stringify({ threadId: "old", botId: "b", at: 0 }));
    expect(takeOpenThreadTarget({ hash: "", pathname: "/", search: "" }, history, storage, OPEN_THREAD_MAX_AGE_MS + 1)).toBeNull();
    storage.setItem(OPEN_THREAD_STORAGE_KEY, "{not json");
    expect(takeOpenThreadTarget({ hash: "", pathname: "/", search: "" }, history, storage, 1)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    const blocked = memoryStorage(true);
    expect(rememberOpenThreadHash("#thread=t&bot=b", blocked)).toEqual({ threadId: "t", botId: "b" });
    expect(takeOpenThreadTarget({ hash: "#thread=t&bot=b", pathname: "/", search: "" }, null, blocked)).toEqual({ threadId: "t", botId: "b" });
    expect(takeOpenThreadTarget({ hash: "", pathname: "/", search: "" }, null, null)).toBeNull();
  });

  it("opens only a thread the viewer's lists hold", () => {
    const state = {
      bots: [{ id: "b", threadId: "t0", tasks: [{ threadId: "t1" }] }],
      groups: [{ id: "g", threadId: "room", tasks: [{ threadId: "room-task" }] }],
    };
    expect(openThreadVisible({ threadId: "t1", botId: "b" }, state)).toBe(true);
    expect(openThreadVisible({ threadId: "t0", botId: "b" }, state)).toBe(true);
    expect(openThreadVisible({ threadId: "room-task", botId: "x" }, state)).toBe(true);
    expect(openThreadVisible({ threadId: "t9", botId: "b" }, state)).toBe(false);
    expect(openThreadVisible({ threadId: "t1", botId: "other" }, state)).toBe(false);
  });
});
