import { describe, expect, it } from "vitest";
import type { DesktopAppearance } from "../../shared/desktop-appearance";
import { readDesktopAppearance, startDesktopAppearanceSync } from "./desktop-appearance-sync";

function harness(options: { status?: number; record?: DesktopAppearance; local?: Record<string, string> } = {}) {
  const local = new Map(Object.entries(options.local ?? {}));
  let server: DesktopAppearance = options.record ?? {};
  const puts: DesktopAppearance[] = [];
  const applied: DesktopAppearance[] = [];
  const timers: number[] = [];
  const fetch = (async (_path: string, init?: RequestInit) => {
    if (options.status && options.status !== 200) return new Response("{}", { status: options.status });
    if (init?.method === "PUT") {
      server = (JSON.parse(String(init.body)) as { preferences: DesktopAppearance }).preferences;
      puts.push(server);
    }
    return new Response(JSON.stringify({ stored: true, preferences: server, updatedAt: 1 }), { status: 200 });
  }) as typeof globalThis.fetch;
  const deps = {
    fetch,
    storage: { getItem: (key: string) => local.get(key) ?? null },
    apply: (next: DesktopAppearance) => {
      applied.push(next);
      local.clear();
      for (const [key, value] of Object.entries(next)) local.set(key, value as string);
    },
    setInterval: (_fn: () => void, ms: number) => timers.push(ms),
  };
  return {
    deps, local, puts, applied, timers,
    phoneWrites: (next: DesktopAppearance) => { server = next; },
  };
}

describe("desktop appearance sync", () => {
  it("does nothing where the computer keeps no desktop appearance", async () => {
    const h = harness({ status: 404 });
    expect(await startDesktopAppearanceSync(h.deps)).toBeNull();
    expect(h.timers).toEqual([]);
  });

  it("saves what the desktop wears at start, then its changes", async () => {
    const h = harness({ record: { "omb-skin": "dusk" }, local: { "omb-skin": "lagoon", "omb-language": "fr" } });
    const sync = await startDesktopAppearanceSync(h.deps);
    expect(h.puts).toEqual([{ "omb-skin": "lagoon" }]);
    expect(h.timers).toEqual([1_500, 5_000]);
    await sync!.push();
    expect(h.puts.length).toBe(1);
    h.local.set("omb-font", "serif");
    await sync!.push();
    expect(h.puts.at(-1)).toEqual({ "omb-skin": "lagoon", "omb-font": "serif" });
  });

  it("wears what the phone wrote, and does not echo it", async () => {
    const h = harness({ local: { "omb-skin": "lagoon" } });
    const sync = await startDesktopAppearanceSync(h.deps);
    await sync!.pull();
    expect(h.applied).toEqual([]);
    h.phoneWrites({ "omb-skin": "retro98", "omb.retro98.on": "1", "omb.retro98.unlocked": "1" });
    await sync!.pull();
    expect(h.applied).toEqual([{ "omb-skin": "retro98", "omb.retro98.on": "1", "omb.retro98.unlocked": "1" }]);
    await sync!.push();
    expect(h.puts.length).toBe(1);
  });

  it("keeps a local change made before the phone's write was read", async () => {
    const h = harness({ local: { "omb-skin": "lagoon" } });
    const sync = await startDesktopAppearanceSync(h.deps);
    h.local.set("omb-skin", "foundry");
    h.phoneWrites({ "omb-skin": "dusk" });
    await sync!.pull();
    expect(h.applied).toEqual([]);
    await sync!.push();
    expect(h.puts.at(-1)).toEqual({ "omb-skin": "foundry" });
  });

  it("reads only valid appearance keys", () => {
    const store = new Map([["omb-skin", "nope"], ["omb-font", "serif"], ["omb.retro98.on", "1"]]);
    expect(readDesktopAppearance({ getItem: (key) => store.get(key) ?? null })).toEqual({ "omb-font": "serif", "omb.retro98.on": "1" });
  });
});
