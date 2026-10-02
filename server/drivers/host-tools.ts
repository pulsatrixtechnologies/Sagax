// The engines' own tools that act on THIS machine. On an organization server
// the machine is the Sagax server (a container), never anyone's computer, so
// a turn withholds them (SendTurnInput.withholdHostTools) and shell and files
// go through the person's server environment instead
// (server/user-sandbox-tools.ts, docs/user-sandbox.md).

/** Claude Code built-ins that run commands, read or write local files, or
 * fetch URLs from this machine (which could reach internal services).
 * Passed to --disallowedTools: deny rules, so they hold for subagents too.
 * Names an older or newer CLI lacks are ignored by the CLI. */
export const CLAUDE_HOST_TOOLS: readonly string[] = [
  "Bash", "BashOutput", "KillShell", "KillBash", "PowerShell", "Monitor",
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead",
  "Glob", "Grep", "LS", "WebFetch",
  // git worktrees and local scripted workflows also act on this machine
  "EnterWorktree", "ExitWorktree", "Workflow", "DesignSync",
];

export function claudeDisallowedTools(configured: readonly string[] | undefined, withhold: boolean): string[] {
  const merged = new Set(configured ?? []);
  if (withhold) for (const tool of CLAUDE_HOST_TOOLS) merged.add(tool);
  return [...merged];
}

/** Codex app-server flags removing its shell (classic and unified exec) and
 * local image viewer. apply_patch has no switch: a read-only sandbox plus a
 * declined approval (codexHostToolDecision) stops it. */
export function codexHostToolArgs(withhold: boolean): string[] {
  return withhold
    ? [
        "-c", "features.shell_tool=false",
        "-c", "features.unified_exec=false",
        "-c", "features.shell_snapshot=false",
        "-c", "features.view_image=false",
        "-c", 'sandbox_mode="read-only"',
      ]
    : [];
}

/** Codex server requests that would act on this machine. Declined outright
 * when host tools are withheld, before any card or auto-accept. */
export function codexHostToolRequest(method: string): boolean {
  return method === "execCommandApproval" || method === "applyPatchApproval" ||
    method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval";
}

/** The approval parameters of a withheld Codex turn: read-only, asking (so
 * every write or command becomes a request the driver declines). */
export const CODEX_WITHHELD_APPROVAL = {
  thread: { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only" },
  turn: { approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } },
} as const;

/** A withheld Codex turn in Full access: Codex never asks (`never`) and its
 * own sandbox stays read-only, so nothing runs or writes on the Sagax server
 * (the target there is the person's environment or desktop, reached through
 * Sagax's MCP tools, which Full lets through without a prompt). */
export const CODEX_WITHHELD_FULL_APPROVAL = {
  thread: { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" },
  turn: { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly" } },
} as const;
