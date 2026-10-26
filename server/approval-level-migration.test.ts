import { describe, expect, it } from "vitest";

import { migratedApprovalLevel, planPermissionModeMigration, type MigrationBot } from "./approval-level-migration.ts";

describe("migratedApprovalLevel (permission mode -> the one approval level)", () => {
  it("Approval keeps every level", () => {
    for (const level of ["ask", "edits", "auto", "full", "custom"] as const) expect(migratedApprovalLevel(level, "approval", true)).toBeNull();
  });
  it("Automatic approval lifts Ask and Auto-accept edits to Approve for me, never lowers", () => {
    expect(migratedApprovalLevel("ask", "auto", true)).toBe("auto");
    expect(migratedApprovalLevel("edits", "auto", true)).toBe("auto");
    expect(migratedApprovalLevel("auto", "auto", true)).toBeNull();
    expect(migratedApprovalLevel("full", "auto", true)).toBeNull();
  });
  it("Bypass becomes Full access where the engine runs it, else Approve for me", () => {
    expect(migratedApprovalLevel("ask", "bypass", true)).toBe("full");
    expect(migratedApprovalLevel("auto", "bypass", true)).toBe("full");
    expect(migratedApprovalLevel("full", "bypass", true)).toBeNull();
    expect(migratedApprovalLevel("ask", "bypass", false)).toBe("auto");
    expect(migratedApprovalLevel("auto", "bypass", false)).toBeNull();
  });
  it("never touches Custom (Codex config.toml)", () => {
    expect(migratedApprovalLevel("custom", "bypass", true)).toBeNull();
    expect(migratedApprovalLevel("custom", "auto", true)).toBeNull();
  });
});

describe("planPermissionModeMigration", () => {
  const bot = (over: Partial<MigrationBot> = {}): MigrationBot => ({ id: "b1", ownerId: "pr_alice", level: "ask", fullSupported: true, tasks: [], ...over });

  it("changes the bot and its conversations that have a level of their own", () => {
    const plan = planPermissionModeMigration({ b1: { mode: "bypass", ownerId: "PR_Alice" } }, [bot({
      tasks: [
        { threadId: "t1", level: "ask", fullSupported: true },
        { threadId: "t2", level: undefined, fullSupported: true },
        { threadId: "t3", level: "full", fullSupported: true },
        { threadId: "t4", level: "edits", fullSupported: false },
      ],
    })]);
    expect(plan).toEqual([{ botId: "b1", level: "full", tasks: [{ threadId: "t1", level: "full" }, { threadId: "t4", level: "auto" }] }]);
  });

  it("drops a mode chosen by a previous owner, or for a bot that is gone, without a change", () => {
    expect(planPermissionModeMigration({ b1: { mode: "auto", ownerId: "pr_bob" } }, [bot()])).toEqual([]);
    expect(planPermissionModeMigration({ gone: { mode: "auto", ownerId: "pr_alice" } }, [bot()])).toEqual([]);
    expect(planPermissionModeMigration({ b1: { mode: "approval", ownerId: "pr_alice" } }, [bot()])).toEqual([]);
  });
});
