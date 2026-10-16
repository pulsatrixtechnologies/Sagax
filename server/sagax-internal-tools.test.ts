import { describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { memberBotAdminApproval } from "./engine-access.ts";
import { gateReadOnlyTools } from "./drivers/acp/grok-approval-gate.ts";
import { dataToolName, sagaxInternalTool } from "./sagax-internal-tools.ts";

// JC, 2026-10-16: a member's bot (Moss, Grok Build) asked an approval for
// data__data_load, and the card went to the organization admins.
describe("Sagax's own person-scoped tools", () => {
  it("names the Data tools exactly, in every engine's spelling", () => {
    for (const name of ["data__data_load", "mcp__data__data_sql", "data.data_show", "data:data_export", "data__data_describe"]) {
      expect(dataToolName(name)).not.toBeNull();
    }
    for (const name of ["data__data_drop", "mydata__data_load", "data__load", "datadata_load", "perspicax_data__data_load", "data__data_load extra", "Bash"]) {
      expect(dataToolName(name)).toBeNull();
    }
  });

  it("counts Data and the agents tools of the bot's own scope, never a host-level agents tool", () => {
    expect(sagaxInternalTool("data__data_load")).toBe("data");
    expect(sagaxInternalTool("agents__send_to_bot")).toBe("agents");
    expect(sagaxInternalTool("mcp__agents__memory_update")).toBe("agents");
    for (const name of ["agents__act", "agents__add_mcp_server", "agents__vm_exec", "agents__attach_file", "sagax-environment__run_command", "browser__navigate", "other"]) {
      expect(sagaxInternalTool(name)).toBeNull();
    }
  });

  it("never sends a member's Data call to an admin", () => {
    expect(memberBotAdminApproval({ tool: "data__data_load", workspaceRoot: "/nowhere" })).toBe(false);
    expect(memberBotAdminApproval({ tool: "mcp__data__data_sql", workspaceRoot: "/nowhere" })).toBe(false);
    // a look-alike server still needs an admin
    expect(memberBotAdminApproval({ tool: "files__data_load", workspaceRoot: "/nowhere" })).toBe(true);
  });

  it("approves without a card at every level, a gate card included", () => {
    for (const mode of ["ask", "edits", "auto", "custom", "full"] as const) {
      expect(autoVerdict(mode, "other", { sagaxInternal: true })).toEqual({ approve: "approved other (Sagax tool)", source: "sagax-internal" });
    }
    expect(autoVerdict("auto", "other", { sagaxInternal: true, sagaxGate: true }).source).toBe("sagax-internal");
  });

  it("still lets a safety hold, the person's own deny or ask, and a sandbox widening win", () => {
    expect(autoVerdict("ask", "other", { sagaxInternal: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("ask", "other", { sagaxInternal: true, customRule: { behavior: "deny", id: "r" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("ask", "other", { sagaxInternal: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("ask", "other", { sagaxInternal: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("ask", "AskUserQuestion", { sagaxInternal: true }).approve).toBeNull();
  });

  it("lets a gated Grok turn run the Data tools unasked", () => {
    expect(gateReadOnlyTools({ name: "data", builtin: true })).toEqual(expect.arrayContaining(["data_load", "data_sql", "data_show", "data_export", "data_describe"]));
    expect(gateReadOnlyTools({ name: "data", builtin: false })).toEqual([]);
  });
});
