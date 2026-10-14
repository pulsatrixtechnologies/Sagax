import { afterEach, describe, expect, it, vi } from "vitest";
import { orderedItems, orgMemoryStatus, resetOrgMemoryForTests, runOrgMemoryAuto, tiersNeedingAttention, type OrgMemoryBridge, type OrgMemoryState } from "./org-memory";

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
    const failing = { auto: vi.fn(async () => { throw new Error("ipc"); }) } as unknown as OrgMemoryBridge;
    expect(await runOrgMemoryAuto(failing)).toMatchObject({ connected: true });
  });

  it("lists pending items first, then refusals, and flags tiers that need the person", () => {
    const items = orderedItems([
      { tier: "org", title: "A", state: "approved" },
      { tier: "org", title: "B", state: "refused", reason: "trop long" },
      { tier: "team-x", title: "C", state: "pending", path: "team-x/_pending/c.md" },
    ]);
    expect(items.map((i) => i.title)).toEqual(["C", "B", "A"]);
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
