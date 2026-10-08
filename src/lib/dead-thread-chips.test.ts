import { describe, expect, it } from "vitest";

import { groupActivityRuns, groupTranscript } from "./activity-runs";
import { navigationTargetGone, withoutDeadThreadChips } from "./dead-thread-chips";
import type { Message } from "@/state/store";

let seq = 0;
const tool = (name: string): Message => ({ id: `t${++seq}`, at: seq, role: "bot", kind: "activity", tool: { name, ok: true } });
const opened = (botId: string, threadId: string, gone?: boolean): Message => ({
  ...tool("Opened thread"),
  threadRef: { botId, threadId, title: "T", ...(gone ? { gone } : {}) },
});
const comm = (groupId: string, threadId?: string, gone?: boolean): Message => ({
  ...tool("Messaged Scout"),
  comm: { groupId, withBotId: "scout", withName: "Scout", withColor: "green", ...(threadId ? { threadId } : {}), ...(gone ? { gone } : {}) },
});

const owners = {
  bots: [{ id: "scout", threadId: "s-main", tasks: [{ threadId: "s-main" }, { threadId: "qa" }] }],
  groups: [{ id: "g1", threadId: "g1-main", tasks: [{ threadId: "g1-main" }, { threadId: "g1-side" }] }],
};

describe("navigationTargetGone", () => {
  it("keeps a chip whose thread exists, on a bot or in a room", () => {
    expect(navigationTargetGone(opened("scout", "qa"), owners)).toBe(false);
    expect(navigationTargetGone(opened("g1", "g1-side"), owners)).toBe(false);
  });

  it("hides a chip whose thread the viewer can see is gone, even without a server mark", () => {
    expect(navigationTargetGone(opened("scout", "deleted"), owners)).toBe(true);
  });

  it("keeps the chip when the thread exists even if a stale server mark says gone", () => {
    expect(navigationTargetGone(opened("scout", "qa", true), owners)).toBe(false);
  });

  it("falls back to the server mark for a bot the viewer cannot see", () => {
    expect(navigationTargetGone(opened("org-bot", "x"), owners)).toBe(false);
    expect(navigationTargetGone(opened("org-bot", "x", true), owners)).toBe(true);
  });

  it("applies the same rule to a Messaged chip that links to a channel thread", () => {
    expect(navigationTargetGone(comm("g1", "g1-side"), owners)).toBe(false);
    expect(navigationTargetGone(comm("g1", "g1-old"), owners)).toBe(true);
    expect(navigationTargetGone(comm("g1"), owners)).toBe(false);
    expect(navigationTargetGone(comm("hidden-group", "t"), owners)).toBe(false);
    expect(navigationTargetGone(comm("hidden-group", "t", true), owners)).toBe(true);
  });
});

describe("withoutDeadThreadChips", () => {
  it("returns the same array when nothing is dead", () => {
    const messages = [tool("Edit"), opened("scout", "qa")];
    expect(withoutDeadThreadChips(messages, owners)).toBe(messages);
  });

  it("drops dead chips and the grouping leaves no empty run behind", () => {
    const dead = opened("scout", "deleted");
    const live = opened("scout", "qa");
    const messages = [tool("Edit"), tool("Bash"), dead, tool("Write"), tool("Read"), live];
    // The chip used to split the work into two runs; without it there is one.
    expect(groupActivityRuns(messages).map((i) => i.kind)).toEqual(["run", "message", "run", "message"]);
    const kept = withoutDeadThreadChips(messages, owners);
    expect(kept).not.toContain(dead);
    expect(kept).toContain(live);
    const items = groupTranscript(kept);
    expect(items.map((i) => i.kind)).toEqual(["run", "message"]);
    for (const item of items) if (item.kind === "run") expect(item.messages.length).toBeGreaterThan(0);
  });

  it("leaves nothing at all when the only row was a dead chip", () => {
    expect(groupTranscript(withoutDeadThreadChips([opened("scout", "deleted")], owners))).toEqual([]);
  });
});
