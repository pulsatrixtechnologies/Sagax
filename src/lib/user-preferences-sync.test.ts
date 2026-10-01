import { describe, expect, it, vi } from "vitest";
import { applyPreferences, PREFERENCES_PATH, readPreferences, startPreferenceSync } from "./user-preferences-sync";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function server(record: unknown, status = 200) {
  const puts: unknown[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)).preferences);
      return new Response(JSON.stringify({ stored: true }), { status: 200 });
    }
    return new Response(JSON.stringify(record), { status });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, puts, calls: fetch };
}

const noTimer = () => undefined;

describe("a person's preferences on an organization server", () => {
  it("reads and applies only the known keys", () => {
    const storage = memory({ "omb-skin": "midnight", "omb-drafts": "{}" });
    expect(readPreferences(storage)).toEqual({ "omb-skin": "midnight" });
    applyPreferences(storage, { "omb-font": "serif" });
    expect(storage.values.get("omb-skin")).toBeUndefined();
    expect(storage.values.get("omb-font")).toBe("serif");
    expect(storage.values.get("omb-drafts")).toBe("{}");
  });

  it("the server's record wins over what this page held", async () => {
    const storage = memory({ "omb-skin": "paper", "omb-language": "en", "omb-drafts": "kept" });
    const remote = server({ stored: true, preferences: { "omb-skin": "midnight", "omb-drafts": "nope" } });
    const sync = await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer });
    expect(sync).not.toBeNull();
    expect(storage.values.get("omb-skin")).toBe("midnight");
    expect(storage.values.has("omb-language")).toBe(false);
    expect(storage.values.get("omb-drafts")).toBe("kept");
    expect(remote.puts).toEqual([]);
  });

  it("the first time, saves what this computer's solo app had, without asking and without touching it", async () => {
    const storage = memory();
    const remote = server({ stored: false, preferences: {}, updatedAt: null });
    const takeLocal = vi.fn(async () => ({ "omb-skin": "midnight", "omb-language": "fr", "omb-webhook-credentials": "secret" }));
    await startPreferenceSync({ fetch: remote.fetch, storage, takeLocalPreferences: takeLocal, setInterval: noTimer });
    expect(takeLocal).toHaveBeenCalledOnce();
    expect(remote.puts).toEqual([{ "omb-skin": "midnight", "omb-language": "fr" }]);
    expect(storage.values.get("omb-skin")).toBe("midnight");
  });

  it("without a hand-over, the first time saves this page's own values; with none at all it saves nothing", async () => {
    const page = memory({ "omb-font": "serif" });
    const first = server({ stored: false });
    await startPreferenceSync({ fetch: first.fetch, storage: page, setInterval: noTimer });
    expect(first.puts).toEqual([{ "omb-font": "serif" }]);
    const empty = server({ stored: false });
    await startPreferenceSync({ fetch: empty.fetch, storage: memory(), setInterval: noTimer });
    expect(empty.puts).toEqual([]);
  });

  it("saves a change back, once", async () => {
    const storage = memory();
    const remote = server({ stored: true, preferences: { "omb-skin": "paper" } });
    const sync = (await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer }))!;
    await sync.check();
    expect(remote.puts).toEqual([]);
    storage.setItem("omb-skin", "midnight");
    storage.setItem("omb-drafts", "not a preference");
    await sync.check();
    await sync.check();
    expect(remote.puts).toEqual([{ "omb-skin": "midnight" }]);
  });

  it("keeps everything local where the server keeps no preferences (a solo server, the operator)", async () => {
    const storage = memory({ "omb-skin": "paper" });
    const remote = server({ error: "no" }, 404);
    expect(await startPreferenceSync({ fetch: remote.fetch, storage, setInterval: noTimer })).toBeNull();
    expect(remote.calls).toHaveBeenCalledOnce();
    expect(remote.calls.mock.calls[0][0]).toBe(PREFERENCES_PATH);
    expect(storage.values.get("omb-skin")).toBe("paper");
  });
});
