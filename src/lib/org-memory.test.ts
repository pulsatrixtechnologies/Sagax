import { afterEach, describe, expect, it, vi } from "vitest";
import { orgMemoryStatus, refusedCount, resetOrgMemoryForTests, runOrgMemoryAuto, tiersNeedingAttention, type OrgMemoryBridge, type OrgMemoryState } from "./org-memory";

const base: OrgMemoryState = {
  connected: false,
  server: null,
  vault: "/Users/jc/Library/Application Support/sagax/org-memory/vault",
  cloned: false,
  obsidianConfigured: false,
  obsidianUrl: "obsidian://open?path=x",
  cloudFolder: null,
  busy: false,
  tiers: [],
  pending: [],
  pendingCount: 0,
  lastSyncAt: null,
  lastError: null,
};

describe("org memory (Settings > Memory)", () => {
  afterEach(() => resetOrgMemoryForTests());

  it("says where the automatic setup stands", () => {
    expect(orgMemoryStatus(null)).toBe("setting-up");
    expect(orgMemoryStatus(base, true)).toBe("setting-up");
    const synced = { ...base, connected: true, cloned: true, lastSyncAt: 1, mode: "auto" as const };
    expect(orgMemoryStatus(synced)).toBe("synced");
    expect(orgMemoryStatus({ ...synced, busy: true })).toBe("syncing");
    expect(orgMemoryStatus({ ...synced, autoError: "unreachable" })).toBe("failed");
    expect(orgMemoryStatus({ ...base, autoError: "not_member" })).toBe("failed");
  });

  it("runs one automatic attempt at a time and never throws", async () => {
    let resolve: (s: OrgMemoryState) => void = () => {};
    const bridge = { auto: vi.fn(() => new Promise<OrgMemoryState>((r) => { resolve = r; })) } as unknown as OrgMemoryBridge;
    const first = runOrgMemoryAuto(bridge);
    const second = runOrgMemoryAuto(bridge);
    expect(bridge.auto).toHaveBeenCalledTimes(1);
    resolve({ ...base, connected: true });
    expect(await first).toMatchObject({ connected: true });
    expect(await second).toMatchObject({ connected: true });
    const failing = { auto: vi.fn(async () => { throw new Error("ipc"); }), state: vi.fn(async () => { throw new Error("ipc"); }) } as unknown as OrgMemoryBridge;
    expect(await runOrgMemoryAuto(failing)).toMatchObject({ connected: true });
  });

  it("a failed attempt reads the state again instead of keeping Syncing", async () => {
    const bridge = {
      auto: vi.fn(async () => { throw new Error("ipc"); }),
      state: vi.fn(async () => ({ ...base, connected: true, cloned: true, lastSyncAt: 2 })),
    } as unknown as OrgMemoryBridge;
    const state = await runOrgMemoryAuto(bridge);
    expect(state).toMatchObject({ connected: true, busy: false, lastSyncAt: 2 });
    expect(orgMemoryStatus(state)).toBe("synced");
  });

  it("counts recent refusals only, and flags tiers that need the person", () => {
    expect(refusedCount([
      { tier: "org", title: "A", state: "approved" },
      { tier: "org", title: "B", state: "refused", reason: "trop long" },
      { tier: "team-x", title: "C", state: "pending", path: "team-x/_pending/c.md" },
    ])).toBe(1);
    const state = {
      ...base,
      tiers: [
        { name: "me", label: "Moi", push: "direct", status: "pushed" as const, messages: [] },
        { name: "org", label: "Organisation", push: "review", status: "refused" as const, messages: ["memory_path_refused"] },
      ],
    };
    expect(tiersNeedingAttention(state).map((t) => t.name)).toEqual(["org"]);
  });
});
