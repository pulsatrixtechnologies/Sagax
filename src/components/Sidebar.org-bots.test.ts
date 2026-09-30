import { describe, expect, it } from "vitest";
import type { Bot } from "@/state/store";

import { sidebarListedBots } from "./Sidebar";

const bot = (id: string, ownerUserId?: string, section?: string): Bot => ({
  id, threadId: `t-${id}`, name: id, title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "fake", model: "test" }, messages: [],
  ...(ownerUserId ? { ownerUserId } : {}), ...(section ? { section } : {}),
});

describe("sidebarListedBots", () => {
  const mine = bot("mine", "pr_bob", "Ops");
  const shared = bot("x", "pr_alice", "Alice private");
  const sharedInSection = bot("y", "pr_alice", "Shared ops");

  it("keeps a bot someone shared with you in an organization, in General unless you see its section", () => {
    const listed = sidebarListedBots([mine, shared, sharedInSection], "pr_bob", true, ["Ops", "Shared ops"]);
    expect(listed.map((b) => b.id)).toEqual(["mine", "x", "y"]);
    expect(listed.find((b) => b.id === "x")?.section).toBeUndefined();
    expect(listed.find((b) => b.id === "y")?.section).toBe("Shared ops");
    expect(listed.find((b) => b.id === "mine")?.section).toBe("Ops");
  });

  it("still leaves another person's bot out on a shared workspace", () => {
    expect(sidebarListedBots([mine, shared], "pr_bob", false).map((b) => b.id)).toEqual(["mine"]);
  });
});
