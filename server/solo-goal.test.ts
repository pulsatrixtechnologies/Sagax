import { describe, expect, it } from "vitest";
import {
  SOLO_GOAL_MAX_ROUNDS,
  SoloGoals,
  soloGoalCommand,
  soloGoalContinuePrompt,
  soloGoalOutcome,
  soloGoalStatusText,
  soloGoalSystemPrompt,
  withoutSoloGoalMarker,
} from "./solo-goal.ts";

describe("solo goal", () => {
  it("reads a 1:1 /goal without taking a team's subcommands", () => {
    expect(soloGoalCommand("/goal ship the notes")).toEqual({ kind: "start", goal: "ship the notes" });
    expect(soloGoalCommand("ship the notes", "goal")).toEqual({ kind: "start", goal: "ship the notes" });
    expect(soloGoalCommand("/goal status")).toEqual({ kind: "status" });
    expect(soloGoalCommand("/goal stop")).toEqual({ kind: "stop" });
    expect(soloGoalCommand("hello")).toEqual({ kind: "none" });
  });

  it("keeps working until the reply says the goal is done", () => {
    const goals = new SoloGoals();
    goals.start("t", "ship the notes");
    expect(goals.noteReply("t", "Still writing.")).toBeNull();
    expect(goals.get("t")?.status).toBe("working");
    const done = soloGoalOutcome('Finished.\n<sagax-goal>{"status":"completed","detail":"notes shipped"}</sagax-goal>');
    expect(done).toEqual({ status: "completed", detail: "notes shipped" });
    expect(goals.noteReply("t", 'Finished.\n<sagax-goal>{"status":"completed","detail":"notes shipped"}</sagax-goal>')?.status).toBe("completed");
    expect(soloGoalStatusText(goals.get("t"))).toContain("notes shipped");
    expect(goals.stop("t")?.status).toBe("completed");
  });

  // #1372: the instruction rides the system prompt, never the person's message
  it("puts the instruction in the system prompt only while the goal works", () => {
    const goals = new SoloGoals();
    expect(soloGoalSystemPrompt(goals.get("t"))).toBe("");
    goals.start("t", "ship the notes");
    const prompt = soloGoalSystemPrompt(goals.get("t"));
    expect(prompt).toContain("Goal: ship the notes");
    expect(prompt).toContain("<sagax-goal>");
    expect(soloGoalContinuePrompt(goals.get("t")!)).toContain("ship the notes");
    goals.stop("t");
    expect(soloGoalSystemPrompt(goals.get("t"))).toBe("");
  });

  it("takes the marker out of the reply the person sees", () => {
    expect(withoutSoloGoalMarker('All done.\n<sagax-goal>{"status":"completed","detail":"notes shipped"}</sagax-goal>')).toBe("All done.");
    expect(withoutSoloGoalMarker('<sagax-goal>{"status":"completed"}</sagax-goal>')).toBe("");
    expect(withoutSoloGoalMarker("No marker here.")).toBe("No marker here.");
  });

  it("waits for the person when blocked, and works again when they write", () => {
    const goals = new SoloGoals();
    goals.start("t", "ship the notes");
    expect(goals.noteReply("t", 'Which folder?\n<sagax-goal>{"status":"blocked","detail":"the folder"}</sagax-goal>')?.status).toBe("blocked");
    expect(goals.nextRound("t")).toBe(false);
    expect(soloGoalStatusText(goals.get("t"))).toBe("Waiting for you: ship the notes (the folder)");
    goals.resume("t");
    expect(goals.get("t")?.status).toBe("working");
  });

  it("starts at most SOLO_GOAL_MAX_ROUNDS turns on its own, then waits", () => {
    const goals = new SoloGoals();
    goals.start("t", "ship the notes");
    for (let round = 0; round < SOLO_GOAL_MAX_ROUNDS; round += 1) expect(goals.nextRound("t")).toBe(true);
    expect(goals.nextRound("t")).toBe(false);
    goals.resume("t");
    expect(goals.nextRound("t")).toBe(true);
  });

  it("puts back the previous goal when the send that started a new one is refused", () => {
    const goals = new SoloGoals();
    const before = goals.get("t");
    goals.start("t", "ship the notes");
    goals.restore("t", before);
    expect(goals.get("t")).toBeUndefined();
  });
});
