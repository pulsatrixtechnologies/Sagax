import { describe, expect, it } from "vitest";

import { NUDGE_COOLDOWN_MS, NudgeCooldown, groupNudgeKey, groupNudgeTargets, nudgeCooldownError, nudgeFrameAllowed, recordNudgeLine, type NudgeLineStore } from "./nudge.ts";

describe("nudge cooldown", () => {
  it("refuses a second nudge inside 5 minutes and allows it once the window has passed", () => {
    const cooldown = new NudgeCooldown();
    const start = 1_700_000_000_000;
    expect(cooldown.tryAcquire("pr_alice", "pr_bob", start)).toEqual({ ok: true });

    const early = cooldown.tryAcquire("pr_alice", "pr_bob", start + 1_000);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.retryAfterMs).toBe(NUDGE_COOLDOWN_MS - 1_000);

    // A refused try does not push the deadline out.
    const still = cooldown.tryAcquire("PR_ALICE", "PR_BOB", start + 60_000);
    expect(still.ok).toBe(false);
    if (!still.ok) expect(still.retryAfterMs).toBe(NUDGE_COOLDOWN_MS - 60_000);

    // The same server map blocks a second client of the sender.
    expect(cooldown.tryAcquire("pr_alice", "pr_bob", start + NUDGE_COOLDOWN_MS - 1).ok).toBe(false);
    expect(cooldown.tryAcquire("pr_alice", "pr_bob", start + NUDGE_COOLDOWN_MS)).toEqual({ ok: true });
  });

  it("keeps each sender and target pair on its own clock", () => {
    const cooldown = new NudgeCooldown();
    expect(cooldown.tryAcquire("pr_alice", "pr_bob", 0).ok).toBe(true);
    expect(cooldown.tryAcquire("pr_carol", "pr_bob", 0).ok).toBe(true);
    expect(cooldown.tryAcquire("pr_alice", "pr_carol", 0).ok).toBe(true);
    expect(cooldown.tryAcquire("pr_bob", "pr_alice", 0).ok).toBe(true);
    expect(cooldown.tryAcquire("pr_alice", "pr_bob", 1).ok).toBe(false);
  });

  it("says how long is left", () => {
    expect(nudgeCooldownError(90_000)).toBe("Wait 2 minutes before nudging them again.");
    expect(nudgeCooldownError(60_000)).toBe("Wait 1 minute before nudging them again.");
    expect(nudgeCooldownError(15_000)).toBe("Wait 15 seconds before nudging them again.");
  });

  it("delivers a nudge only to the person it names", () => {
    const frame = { kind: "nudge", audience: "pr_bob" };
    expect(nudgeFrameAllowed(frame, "pr_bob", "pr_local")).toBe(true);
    expect(nudgeFrameAllowed(frame, "PR_BOB", "pr_local")).toBe(true);
    expect(nudgeFrameAllowed(frame, "pr_alice", "pr_local")).toBe(false);
    expect(nudgeFrameAllowed(frame, undefined, "pr_bob")).toBe(true);
    expect(nudgeFrameAllowed(frame, undefined, "pr_local")).toBe(false);
    expect(nudgeFrameAllowed({ kind: "message" }, "pr_alice", "pr_local")).toBe(true);
  });
});

describe("nudge transcript line", () => {
  function harness(existing?: { id: string; threadId: string }) {
    const appended: Array<{ threadId: string; message: { kind: string; nudge?: { fromName: string; toName: string } } }> = [];
    const unread: string[] = [];
    const created: string[] = [];
    const store: NudgeLineStore = {
      find: () => existing,
      create: ({ name }) => {
        created.push(name);
        return { id: "dm-new", threadId: "thread-new" };
      },
      append: (threadId, message) => { appended.push({ threadId, message }); },
      markUnread: (groupId) => { unread.push(groupId); },
    };
    return { store, appended, unread, created };
  }

  const line = { fromId: "pr_jean", fromName: "Jean-Christophe", toId: "pr_ada", toName: "Ada", at: 50 };

  it("appends the line to the conversation the two people already share", () => {
    const fixture = harness({ id: "dm-1", threadId: "thread-1" });
    recordNudgeLine(fixture.store, line);
    expect(fixture.created).toEqual([]);
    expect(fixture.unread).toEqual(["dm-1"]);
    expect(fixture.appended).toEqual([{
      threadId: "thread-1",
      message: {
        role: "bot",
        kind: "nudge",
        at: 50,
        nudge: { fromId: "pr_jean", fromName: "Jean-Christophe", toId: "pr_ada", toName: "Ada" },
      },
    }]);
  });

  it("opens the conversation when they do not share one yet", () => {
    const fixture = harness();
    recordNudgeLine(fixture.store, line);
    expect(fixture.created).toEqual(["Jean-Christophe, Ada"]);
    expect(fixture.appended[0]?.threadId).toBe("thread-new");
    expect(fixture.unread).toEqual(["dm-new"]);
  });

  it("writes one line on the group chat and does not open a direct conversation", () => {
    const fixture = harness();
    fixture.store.findGroup = () => ({ id: "room-1", threadId: "room-thread" });
    recordNudgeLine(fixture.store, { ...line, toId: "room-1", toName: "Launch planning", groupId: "room-1" });
    expect(fixture.created).toEqual([]);
    expect(fixture.unread).toEqual(["room-1"]);
    expect(fixture.appended).toEqual([{
      threadId: "room-thread",
      message: {
        role: "bot",
        kind: "nudge",
        at: 50,
        nudge: { fromId: "pr_jean", fromName: "Jean-Christophe", toId: "room-1", toName: "Launch planning", groupId: "room-1" },
      },
    }]);
  });
});

describe("group nudge targets", () => {
  const people = [
    { id: "pr_alice" },
    { id: "pr_bob", teams: [{ id: "ops", manager: false }] },
    { id: "pr_boss", teams: [{ id: "ops", manager: true }] },
    { id: "pr_robot", service: true, teams: [{ id: "ops", manager: false }] },
    { id: "pr_out", disabled: true },
    { id: "pr_cara" },
  ];

  it("names the other people, a team's members, and the section, once", () => {
    const targets = groupNudgeTargets({
      senderId: "PR_ALICE",
      humanIds: ["pr_alice", "user:pr_bob", "team:ops", "pr_out", "pr_robot", "pr_missing"],
      section: { ownerPrincipalId: "pr_cara", members: [{ target: "user:pr_bob" }, { target: "pr_out" }] },
      people,
    });
    expect(targets.map((person) => person.id)).toEqual(["pr_bob", "pr_cara"]);
    expect(groupNudgeKey(" Room-1 ")).toBe("group:Room-1");
  });

  it("returns nobody when only the sender is left", () => {
    expect(groupNudgeTargets({
      senderId: "pr_alice",
      humanIds: ["pr_alice", "pr_robot"],
      section: null,
      people,
    })).toEqual([]);
  });
});
