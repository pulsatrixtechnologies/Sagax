import { describe, expect, it } from "vitest";
import { SoloGoals, soloGoalCommand, soloGoalOutcome, soloGoalPrompt, soloGoalStatusText } from "./solo-goal.ts";

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
    expect(soloGoalPrompt("ship the notes")).toContain("ship the notes");
    goals.noteReply("t", "Still writing.");
    expect(goals.get("t")?.status).toBe("working");
    const done = soloGoalOutcome('Finished.\n<sagax-goal>{"status":"completed","detail":"notes shipped"}</sagax-goal>');
    expect(done).toEqual({ status: "completed", detail: "notes shipped" });
    goals.noteReply("t", 'Finished.\n<sagax-goal>{"status":"completed","detail":"notes shipped"}</sagax-goal>');
    expect(goals.get("t")?.status).toBe("completed");
    expect(soloGoalStatusText(goals.get("t"))).toContain("notes shipped");
    expect(goals.stop("t")?.status).toBe("completed");
  });
});
