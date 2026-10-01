// Organization servers withhold the engines' own shell, file and fetch tools
// (the machine is the Sagax server): the exact CLI flags and the Codex
// requests declined.
import { describe, expect, it } from "vitest";

import { CLAUDE_HOST_TOOLS, CODEX_WITHHELD_APPROVAL, claudeDisallowedTools, codexHostToolArgs, codexHostToolRequest } from "./host-tools.ts";

describe("Claude Code host tools", () => {
  it("denies shell, file and fetch built-ins, keeping configured denials", () => {
    const denied = claudeDisallowedTools(["Task"], true);
    for (const tool of ["Bash", "BashOutput", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "NotebookEdit", "WebFetch"]) expect(denied).toContain(tool);
    expect(denied).toContain("Task");
    expect(denied).not.toContain("WebSearch");
  });

  it("changes nothing on a solo server", () => {
    expect(claudeDisallowedTools(["Task"], false)).toEqual(["Task"]);
    expect(claudeDisallowedTools(undefined, false)).toEqual([]);
    expect(CLAUDE_HOST_TOOLS.every((tool) => !tool.startsWith("mcp__"))).toBe(true);
  });
});

describe("Codex host tools", () => {
  it("turns the shell off and the sandbox read-only", () => {
    const args = codexHostToolArgs(true).join(" ");
    expect(args).toContain("features.shell_tool=false");
    expect(args).toContain("features.unified_exec=false");
    expect(args).toContain('sandbox_mode="read-only"');
    expect(codexHostToolArgs(false)).toEqual([]);
    expect(CODEX_WITHHELD_APPROVAL.turn.sandboxPolicy).toEqual({ type: "readOnly" });
  });

  it("declines every command, patch and permission request, not MCP ones", () => {
    for (const method of ["execCommandApproval", "applyPatchApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"]) {
      expect(codexHostToolRequest(method)).toBe(true);
    }
    expect(codexHostToolRequest("mcpServer/elicitation/request")).toBe(false);
    expect(codexHostToolRequest("item/tool/requestUserInput")).toBe(false);
  });
});
