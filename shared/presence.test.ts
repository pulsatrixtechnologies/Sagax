import { describe, expect, it } from "vitest";

import {
  PRESENCE_AWAY_AFTER_MS,
  PRESENCE_DISCONNECT_GRACE_MS,
  PRESENCE_OFFLINE_AFTER_MS,
  connectionLive,
  connectionState,
  personState,
  presenceHidden,
  publicPresence,
  type PresenceConnection,
  type PresencePage,
} from "./presence.ts";

const T = 10_000_000;
const page = (over: Partial<PresencePage> = {}): PresencePage => ({ kind: "web", at: T, lastInteractionAt: T, systemIdle: "unknown", ...over });
const connection = (over: Partial<PresenceConnection> = {}, pages: PresencePage[] = []): PresenceConnection => ({
  streams: 1, closedAt: null, openedAt: T, lastSeenAt: T,
  pages: new Map(pages.map((entry, index) => [`p${index}`, entry])),
  ...over,
});

describe("presence state machine", () => {
  it("the thresholds are 5 and 10 minutes", () => {
    expect(PRESENCE_AWAY_AFTER_MS).toBe(300_000);
    expect(PRESENCE_OFFLINE_AFTER_MS).toBe(600_000);
  });

  it("online while the person used a connected page within 5 minutes, away after", () => {
    const live = connection({}, [page({ lastInteractionAt: T })]);
    expect(connectionState(live, T)).toBe("online");
    expect(connectionState(live, T + PRESENCE_AWAY_AFTER_MS)).toBe("online");
    const idle = connection({ lastSeenAt: T + PRESENCE_AWAY_AFTER_MS + 1 }, [page({ at: T + PRESENCE_AWAY_AFTER_MS + 1, lastInteractionAt: T })]);
    expect(connectionState(idle, T + PRESENCE_AWAY_AFTER_MS + 1)).toBe("away");
  });

  it("away at once when the desktop says the computer is idle or locked", () => {
    expect(connectionState(connection({}, [page({ kind: "desktop", systemIdle: "idle" })]), T)).toBe("away");
    expect(connectionState(connection({}, [page({ kind: "desktop", systemIdle: "locked" })]), T)).toBe("away");
    expect(connectionState(connection({}, [page({ kind: "desktop", systemIdle: "active" })]), T)).toBe("online");
  });

  it("one active page is enough", () => {
    const both = connection({}, [page({ systemIdle: "locked" }), page({ lastInteractionAt: T - 1_000 })]);
    expect(connectionState(both, T)).toBe("online");
  });

  it("a client with no heartbeat (the phone) is online for 5 minutes after connecting, then away", () => {
    expect(connectionState(connection(), T + 60_000)).toBe("online");
    expect(connectionState(connection({ lastSeenAt: T + PRESENCE_AWAY_AFTER_MS + 1 }), T + PRESENCE_AWAY_AFTER_MS + 1)).toBe("away");
  });

  it("offline once every stream closed, after the reconnect grace", () => {
    const closed = connection({ streams: 0, closedAt: T }, [page()]);
    expect(connectionLive(closed, T + PRESENCE_DISCONNECT_GRACE_MS)).toBe(true);
    expect(connectionState(closed, T + PRESENCE_DISCONNECT_GRACE_MS)).toBe("online");
    expect(connectionState(closed, T + PRESENCE_DISCONNECT_GRACE_MS + 1)).toBe("offline");
  });

  it("offline when a client vanished without closing: no sign for 10 minutes", () => {
    const vanished = connection({}, [page()]);
    expect(connectionState(vanished, T + PRESENCE_OFFLINE_AFTER_MS)).toBe("away");
    expect(connectionState(vanished, T + PRESENCE_OFFLINE_AFTER_MS + 1)).toBe("offline");
  });

  it("a person is as present as their most present client", () => {
    const away = connection({}, [page({ systemIdle: "locked" })]);
    const online = connection({}, [page()]);
    const gone = connection({ streams: 0, closedAt: T - PRESENCE_DISCONNECT_GRACE_MS - 1 });
    expect(personState([], T)).toBe("offline");
    expect(personState([gone], T)).toBe("offline");
    expect(personState([gone, away], T)).toBe("away");
    expect(personState([away, online, gone], T)).toBe("online");
  });

  it("a hidden person reads as offline with no last-seen time; only \"0\" hides", () => {
    const view = { principalId: "pr_a", state: "online" as const, lastSeenAt: T };
    expect(publicPresence(view, true)).toEqual({ principalId: "pr_a", state: "offline", lastSeenAt: null });
    expect(publicPresence(view, false)).toBe(view);
    expect(presenceHidden("0")).toBe(true);
    for (const value of [undefined, null, "1", "", "false"]) expect(presenceHidden(value)).toBe(false);
  });
});
