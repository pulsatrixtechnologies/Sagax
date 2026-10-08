// The engines' own tools that act on THIS machine. On an organization server
// the machine is the Sagax server (a container), never anyone's computer, so
// a turn withholds them (SendTurnInput.withholdHostTools) and shell and files
// go through the person's server environment instead
// (server/user-sandbox-tools.ts, docs/user-sandbox.md).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";


import { allowsTool, parseToolScope } from "../../shared/tool-scope.ts";
import { DATA_DIR } from "../config.ts";

/** A policy file Sagax owns for withheld turns (a system settings file, a
 * config an engine reads through an environment variable). Written under
 * the data directory, never in a person's home, rewritten only on change. */
export function writeEnginePolicy(name: string, content: string): string {
  const dir = join(DATA_DIR, "engine-policies");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  let current: string | null = null;
  try { current = readFileSync(path, "utf8"); } catch { current = null; }
  if (current !== content) writeFileSync(path, content, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return path;
}

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

/** Grok Build tools that act on this machine, as `grok agent stdio` advertised
 * them on 1.0.46, plus the older names `--deny` and headless mode still use.
 * `search_tool` and `use_tool` stay: they only reach Sagax MCP servers. */
export const GROK_HOST_TOOL_NAMES: readonly string[] = [
  "run_terminal_command", "run_terminal_cmd", "bash",
  "read_file", "search_replace", "write", "list_dir",
  "grep", "grep_search",
  "kill_command_or_subagent", "todo_write",
  "get_command_or_subagent_output", "spawn_subagent", "task",
  "scheduler_create", "scheduler_delete", "scheduler_list",
  "monitor", "workflow",
  "enter_plan_mode", "exit_plan_mode",
  "ask_user_question", "send_feedback",
  "web_search", "web_fetch",
  "image_gen", "image_edit", "image_to_video", "reference_to_video",
];

/** The only Grok tools an organization turn may keep. */
export const GROK_MCP_TOOLS: readonly string[] = ["search_tool", "use_tool"];

/** Permission classes `--deny` still gates. On `grok agent stdio` these do
 * not remove tools from the advertised list (verified 1.0.46); the ACP
 * profile does. They stay so a leader or a newer CLI cannot loosen the turn. */
const GROK_DENY_CLASSES = ["Bash", "Read", "Edit", "Write", "Grep", "WebFetch", "WebSearch"] as const;

/** Global `grok` flags for a withheld turn. `--tools` and `--disallowed-tools`
 * are ignored in `agent stdio` (headless only). `--sandbox` is not used:
 * its child-network block would cut off the person's MCP tools. */
export function grokHostToolArgs(withhold: boolean): string[] {
  if (!withhold) return [];
  return [
    "--no-subagents",
    "--disable-web-search",
    ...GROK_DENY_CLASSES.flatMap((name) => ["--deny", name]),
  ];
}

export interface GrokOrgAgentProfile {
  name: string;
  description: string;
  injectDefaultTools: false;
  tools: string[];
  disallowedTools: string[];
}

/** ACP `session/new` profile that leaves Grok with Sagax MCP tools only.
 * Verified on grok 1.0.46 `agent stdio`: `available_commands_update` then
 * lists `search_tool` and `use_tool` and nothing else. No `toolConfig`
 * ids, so it does not depend on the 1.0.41 registry pin. */
export function grokOrgAgentProfile(scope: unknown, hasMcp: boolean): GrokOrgAgentProfile {
  const parsed = parseToolScope(scope);
  if (!parsed.ok) throw new Error(parsed.error);
  const tools = GROK_MCP_TOOLS.filter((name) => allowsTool(scope, { kind: "native", name }));
  if (tools.length !== GROK_MCP_TOOLS.length) {
    throw new Error(hasMcp
      ? "Grok requires native:search_tool and native:use_tool to find and call selected MCP tools. Allow both explicitly or use Pi."
      : "Grok on an organization server keeps only its MCP tools. Allow native:search_tool and native:use_tool, or clear the tool selection.");
  }
  return {
    name: "sagax-org",
    description: "Sagax MCP tools only. Host shell, files and web stay off.",
    injectDefaultTools: false,
    tools: [...tools],
    disallowedTools: [...GROK_HOST_TOOL_NAMES],
  };
}

/** pi 0.87.1 built-ins (`createAllTools`). `--no-builtin-tools` empties the
 * active set; `--exclude-tools` keeps an extension from turning them back
 * on; `--no-extensions` drops whatever the person's pi directory adds.
 * An explicit `-e` (the Sagax MCP extension) still loads. */
export const PI_HOST_TOOLS: readonly string[] = [
  "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
];

export function piHostToolArgs(withhold: boolean): string[] {
  if (!withhold) return [];
  return ["--no-builtin-tools", "--exclude-tools", PI_HOST_TOOLS.join(","), "--no-extensions"];
}

/** An ACP `session/request_permission` that would act on this machine: a
 * command, a file change, a move or a delete, not a call to one of Sagax's
 * MCP tools (titled `mcp__…`, `mcp.…` or `mcp:…`). Declined outright on a
 * withheld turn (acp/core.ts). */
export function acpHostToolRequest(toolCall: { kind?: unknown; title?: unknown }): boolean {
  const kind = String(toolCall.kind ?? "");
  if (!["execute", "edit", "delete", "move"].includes(kind)) return false;
  return !/^mcp(?:__|[.:_])/i.test(String(toolCall.title ?? ""));
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

/** The folder a withheld turn of an engine that reads workspace files runs
 * in: empty, owned by Sagax. Without file tools the engine needs no folder
 * of the person's, and a `.gemini/` or `.qwen/` file in the turn's folder
 * could otherwise declare a hook or an MCP server, both commands run here. */
export function withheldWorkspace(): string {
  const dir = join(DATA_DIR, "engine-policies", "workspace");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** The MCP server names Sagax passes an ACP engine for a turn (the same
 * names as acp/core.ts mcpServersFor, before a tool scope filter). */
export function sagaxMcpServerNames(integrations: {
  agents?: unknown; composio?: unknown; browser?: unknown; localComputer?: unknown; custom?: Record<string, unknown>;
} | undefined): string[] {
  const names = [
    ...(integrations?.agents ? ["agents"] : []), ...(integrations?.composio ? ["composio"] : []),
    ...(integrations?.browser ? ["browser"] : []), ...(integrations?.localComputer ? ["computer"] : []),
    ...Object.keys(integrations?.custom ?? {}),
  ];
  return [...new Set(names)];
}

/** Droid 0.230.0 built-ins that act on this machine or run an agent, a
 * schedule or a remote action of Factory's (`droid exec --list-tools`, and
 * what `droid exec -o acp` offered the model). */
export const DROID_HOST_TOOLS: readonly string[] = [
  "Execute", "Read", "LS", "Edit", "Create", "ApplyPatch", "MultiEdit", "Grep", "Glob",
  "FetchUrl", "WebSearch", "Task", "TaskOutput", "TaskStop", "Skill", "GenerateImage", "GenerateDroid",
  "Loop", "CreateAutomation", "DeleteAutomation", "EditAutomation", "ListAutomations",
  "ListAutomationTemplates", "ReadAutomation", "StageSettingsChanges", "ProposeMission",
  "StartMissionRun", "EndFeatureRun", "DismissHandoffItems",
];

/* Droid stays refused on an organization server: `droid exec -o acp`
 * ignores `--only-tools` and `--remove-tools` (0.230.0 still offered the
 * model Execute, Read, Edit and the rest with them) and its ACP session
 * takes no tool selection, so nothing withholds these tools there. */

/** Host tool names per ACP engine, as each real CLI offered them to the
 * model (scripts/verify-org-host-tools.ts). */
export const HOST_TOOL_NAMES_BY_ENGINE: Readonly<Record<string, readonly string[]>> = {
  droid: DROID_HOST_TOOLS,
};
