import { describe, expect, it } from "vitest";
import { orderedItems, orgMemoryPhase, suggestedServer, tiersNeedingAttention, tokenPageUrl, type OrgMemoryState } from "./org-memory";

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
  it("walks the clone lifecycle: disconnected, connected, synced, erased", () => {
    expect(orgMemoryPhase(null)).toBe("disconnected");
    expect(orgMemoryPhase(base)).toBe("disconnected");
    const connected = { ...base, connected: true, server: "https://px.example.com" };
    expect(orgMemoryPhase(connected)).toBe("connected");
    const synced = { ...connected, cloned: true, lastSyncAt: 1 };
    expect(orgMemoryPhase(synced)).toBe("synced");
    // erase() answers a state with nothing connected
    expect(orgMemoryPhase({ ...base, lastError: null })).toBe("disconnected");
  });

  it("points to the token page of the organization's Perspicax", () => {
    expect(suggestedServer("https://px.example.com/")).toBe("https://px.example.com");
    expect(suggestedServer("not a url")).toBe("");
    expect(suggestedServer(null)).toBe("");
    expect(tokenPageUrl("https://px.example.com/anything")).toBe("https://px.example.com/console/memory/sync");
    expect(tokenPageUrl("")).toBeNull();
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
