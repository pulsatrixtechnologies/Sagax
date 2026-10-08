import { afterEach, describe, expect, it } from "vitest";

import { PRESENCE_AWAY_AFTER_MS, PRESENCE_HEARTBEAT_MS } from "../../shared/presence";
import {
  applyPresenceFrame,
  applyPresenceList,
  lastSeenAgo,
  presenceEnabled,
  presenceLabel,
  presenceOf,
  resetPresence,
  startPresenceLoop,
} from "./presence";

afterEach(() => resetPresence());

describe("presence store", () => {
  it("shows nothing until the server answered (a solo server never does)", () => {
    expect(presenceEnabled()).toBe(false);
    expect(presenceOf("pr_bob")).toBeNull();
  });

  it("applies the list, then frames; ids are case-insensitive; unknown ids show nothing", () => {
    applyPresenceList([{ principalId: "pr_Bob", state: "online", lastSeenAt: 5 }, { principalId: "pr_cara", state: "bogus" }]);
    expect(presenceOf("PR_BOB")).toEqual({ state: "online", lastSeenAt: 5 });
    expect(presenceOf("pr_cara")).toBeNull();
    expect(presenceOf("team:ops")).toBeNull();
    applyPresenceFrame({ people: [{ principalId: "pr_bob", state: "away", lastSeenAt: 9 }] });
    expect(presenceOf("pr_bob")).toEqual({ state: "away", lastSeenAt: 9 });
  });

  it("your own row follows the frame addressed to you, not the public one", () => {
    applyPresenceList([]);
    applyPresenceFrame({ audience: "pr_me", people: [{ principalId: "pr_me", state: "online", lastSeenAt: 1, hidden: true }] });
    applyPresenceFrame({ people: [{ principalId: "pr_me", state: "offline", lastSeenAt: null }] });
    expect(presenceOf("pr_me")).toEqual({ state: "online", lastSeenAt: 1, hidden: true });
  });
});

describe("presence words", () => {
  const now = 1_000_000_000;
  it("online, away, offline with the last-seen time", () => {
    expect(presenceLabel({ state: "online", lastSeenAt: now }, now)).toBe("Online");
    expect(presenceLabel({ state: "away", lastSeenAt: now }, now)).toBe("Away");
    expect(presenceLabel({ state: "offline", lastSeenAt: null }, now)).toBe("Offline");
    expect(presenceLabel({ state: "offline", lastSeenAt: now - 2 * 3_600_000 }, now)).toBe("Offline, last seen 2 h ago");
    expect(presenceLabel({ state: "online", lastSeenAt: now, hidden: true }, now)).toBe("Online (hidden from others)");
  });
  it("rounds down: just now, minutes, hours, days", () => {
    expect(lastSeenAgo(now - 30_000, now)).toBe("just now");
    expect(lastSeenAgo(now - 7 * 60_000, now)).toBe("7 min ago");
    expect(lastSeenAgo(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });
});

describe("presence loop", () => {
  function fakeServer(listStatus = 200) {
    const beats: Array<Record<string, unknown>> = [];
    let lists = 0;
    const fetch = (async (path: string, init?: RequestInit) => {
      if (path === "/api/org/presence") {
        lists += 1;
        return new Response(JSON.stringify({ people: [{ principalId: "pr_me", state: "offline", lastSeenAt: null }] }), { status: listStatus });
      }
      const body = JSON.parse(String(init?.body));
      beats.push(body);
      const state = body.systemIdle === "locked" || body.idleMs > PRESENCE_AWAY_AFTER_MS ? "away" : "online";
      return new Response(JSON.stringify({ principalId: "pr_me", state, lastSeenAt: 1 }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, beats, lists: () => lists };
  }

  it("does nothing where the server has no presence", async () => {
    const server = fakeServer(404);
    const loop = await startPresenceLoop({ fetch: server.fetch, now: () => 0, kind: "web", setInterval: () => 0, pageId: "pg_test0001" });
    expect(loop).toBeNull();
    expect(server.beats).toEqual([]);
    expect(presenceEnabled()).toBe(false);
  });

  it("beats every minute with the page's idle time, early when the person comes back", async () => {
    const server = fakeServer();
    let now = 10_000_000;
    let tick: (() => void) | null = null;
    let every = 0;
    const loop = await startPresenceLoop({
      fetch: server.fetch, now: () => now, kind: "web", pageId: "pg_test0001",
      setInterval: (fn, ms) => { tick = fn; every = ms; return 1; },
    });
    expect(loop).not.toBeNull();
    expect(every).toBe(PRESENCE_HEARTBEAT_MS);
    expect(server.beats[0]).toEqual({ pageId: "pg_test0001", kind: "web", idleMs: 0, systemIdle: "unknown" });
    expect(presenceOf("pr_me")).toMatchObject({ state: "online" });
    now += PRESENCE_AWAY_AFTER_MS + 60_000;
    tick!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.beats.at(-1)).toMatchObject({ idleMs: PRESENCE_AWAY_AFTER_MS + 60_000 });
    expect(presenceOf("pr_me")).toMatchObject({ state: "away" });
    now += 30_000;
    loop!.interacted();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.beats.at(-1)).toMatchObject({ idleMs: 0 });
    expect(server.beats).toHaveLength(3);
  });

  it("the desktop sends the computer's idle state and its idle time", async () => {
    const server = fakeServer();
    await startPresenceLoop({
      fetch: server.fetch, now: () => 5_000_000, kind: "desktop", pageId: "pg_test0002", setInterval: () => 0,
      systemIdle: async () => ({ state: "locked", idleSeconds: 42 }),
    });
    expect(server.beats[0]).toEqual({ pageId: "pg_test0002", kind: "desktop", idleMs: 0, systemIdle: "locked" });
    expect(presenceOf("pr_me")).toMatchObject({ state: "away" });
  });
});
