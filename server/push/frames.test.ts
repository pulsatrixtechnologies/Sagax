import { describe, expect, it } from "vitest";

import { pushesForFrame, type FramePushDeps } from "./frames.ts";

const deps = (patch: Partial<FramePushDeps> = {}): FramePushDeps => ({
  notificationPeople: () => ["pr_owner"],
  muted: () => false,
  achievementNotifications: () => true,
  achievementName: (id) => (id === "first-chat" ? "First chat" : undefined),
  now: () => 42,
  ...patch,
});

describe("frames to pushes", () => {
  it("a person's direct message goes to its audience only", () => {
    const out = pushesForFrame({ kind: "notify", notification: { kind: "message", botId: "", botName: "Alice", threadId: "t1", groupId: "g1", title: "Alice", body: "Hi", audience: ["PR_BOB"] } }, deps());
    expect(out).toEqual([{ kind: "message", personId: "pr_bob", title: "Alice", body: "Hi", threadId: "t1", groupId: "g1", at: 42 }]);
  });

  it("a bot notification without audience goes to the thread's person, unless they muted that bot", () => {
    const frame = { kind: "notify", notification: { kind: "done", botId: "b1", botName: "Max", threadId: "t2", title: "Max", body: "Done" } };
    expect(pushesForFrame(frame, deps()).map((push) => [push.kind, push.personId, push.botId])).toEqual([["message", "pr_owner", "b1"]]);
    expect(pushesForFrame(frame, deps({ muted: () => true }))).toEqual([]);
  });

  it("maps approvals, questions and failed routines; ignores the rest", () => {
    const kinds = ["approval", "question", "routine-failed", "spend", "turn-failed", "admin-action"].map((kind) =>
      pushesForFrame({ kind: "notify", notification: { kind, botId: "b1", threadId: "t", title: "x", body: "y" } }, deps())[0]?.kind ?? null);
    expect(kinds).toEqual(["approval", "approval", "routine", null, null, null]);
  });

  it("a nudge carries its conversation, its id and the phone's own strings", () => {
    const out = pushesForFrame({ kind: "nudge", audience: "pr_bob", id: "n1", fromId: "pr_alice", fromName: "Alice", at: 7, open: { groupId: "g1", threadId: "t1" } }, deps());
    expect(out).toEqual([{
      kind: "nudge", personId: "pr_bob", title: "Alice sent you a nudge", body: "Open the conversation to answer.",
      titleLocKey: "%@ sent you a nudge", titleLocArgs: ["Alice"], bodyLocKey: "Open the conversation to answer.",
      threadId: "t1", groupId: "g1", fromId: "pr_alice", id: "n1", at: 7,
    }]);
    // the sender's own echo is not a push
    expect(pushesForFrame({ kind: "nudge.sent", audience: "pr_alice", id: "n1" }, deps())).toEqual([]);
  });

  it("an achievement only for a person who asked for system notifications", () => {
    const frame = { kind: "achievements", audience: "pr_bob", unlocked: [{ id: "first-chat", points: 5, unlockedAt: 1 }] };
    expect(pushesForFrame(frame, deps())[0]).toMatchObject({ kind: "achievement", personId: "pr_bob", body: "First chat", titleLocKey: "Achievement unlocked" });
    expect(pushesForFrame(frame, deps({ achievementNotifications: () => false }))).toEqual([]);
  });
});
