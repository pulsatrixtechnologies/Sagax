// Whether the conversation is development work, where the context pods are
// useful. Purely local: it reads the transcript the chat already holds (tool
// rows, paths, pull request links, code blocks) and the bot's computer
// state. Nothing is fetched and nothing is sent.
//
// The score of the recent window feeds a small hysteresis (devModeStep) so
// the pods do not come and go on every turn: they appear once the score
// reaches ENTER_SCORE and leave only after EXIT_STREAK evaluations in a row
// under EXIT_SCORE.
import type { Message } from "@/state/store";

/** How many of the latest messages the score reads. */
export const DEV_WINDOW = 24;
/** Score that turns the pods on. */
export const ENTER_SCORE = 4;
/** Under this score an evaluation counts toward turning the pods off. */
export const EXIT_SCORE = 2;
/** Evaluations in a row under EXIT_SCORE before the pods turn off. */
export const EXIT_STREAK = 3;

export type DevToolKind = "shell" | "git" | "edit" | "pr";

const SHELL = new Set(["bash", "shell", "execute", "bashoutput", "run_command", "exec", "vm_exec", "terminal", "exec_command", "command_execution", "local_shell"]);
const EDIT = new Set(["write", "edit", "multiedit", "notebookedit", "write_file", "create_file", "edit_file", "str_replace", "str_replace_editor", "apply_patch", "file_change", "patch"]);

const GIT_COMMAND = /(?:^|[\s;&|(])git\s+(?:commit|push|pull|checkout|switch|branch|merge|rebase|worktree|diff|status|log|add|fetch|clone|cherry-pick|stash|tag)\b/;
const PR_COMMAND = /(?:^|[\s;&|(])gh\s+pr\s+(?:create|merge|view|edit|checkout)\b/;
const PR_URL = /https?:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i;
const REPO_PATH = /(?:^|[\s"'`(])(?:~|\.{1,2})?\/?(?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|swift|kt|java|rb|php|cs|c|cc|cpp|h|hpp|css|scss|vue|svelte|sql|sh|ya?ml|toml|json|md)\b/;
const CODE_FENCE = /```[\w-]*\n[\s\S]*?```/g;

/** The development signal one tool row carries, if any. */
export function toolKind(tool: NonNullable<Message["tool"]>): DevToolKind | null {
  const name = tool.name.trim();
  const bare = name.toLowerCase().replace(/^mcp__[^_]+__/, "");
  const text = `${tool.summary ?? ""}\n${tool.input ?? ""}`;
  if (PR_COMMAND.test(text) || PR_URL.test(tool.output ?? "")) return "pr";
  if (GIT_COMMAND.test(text)) return "git";
  if (EDIT.has(bare)) return "edit";
  if (SHELL.has(bare)) return "shell";
  if (bare.startsWith("git_") || bare.startsWith("github")) return "git";
  return null;
}

export interface DevSignalInput {
  messages: readonly Message[];
  /** The bot's computer is starting, or the thread runs on one with a screen. */
  computerActive?: boolean;
  /** An explicit mark from the bot. No such channel exists in turn metadata
   * today; the input is here so one can be wired without touching the score. */
  explicit?: boolean;
}

export interface DevSignals {
  score: number;
  tools: Record<DevToolKind, number>;
  repoPaths: number;
  codeBlocks: number;
  prLinks: number;
}

const WEIGHT: Record<DevToolKind, number> = { shell: 1, git: 3, edit: 3, pr: 4 };

/** The score of the recent window. Each kind of signal is capped so one
 * chatty signal (a long run of reads, a reply full of snippets) cannot
 * outweigh the others on its own. */
export function devSignals({ messages, computerActive, explicit }: DevSignalInput): DevSignals {
  const recent = messages.slice(-DEV_WINDOW);
  const tools: Record<DevToolKind, number> = { shell: 0, git: 0, edit: 0, pr: 0 };
  let repoPaths = 0;
  let codeBlocks = 0;
  let prLinks = 0;
  for (const message of recent) {
    if (message.kind === "activity" && message.tool) {
      const kind = toolKind(message.tool);
      if (kind) tools[kind] += 1;
      if (REPO_PATH.test(`${message.tool.summary ?? ""} ${message.tool.input ?? ""}`)) repoPaths += 1;
      continue;
    }
    if (message.kind !== "text" || !message.text) continue;
    if (message.role === "bot") codeBlocks += message.text.match(CODE_FENCE)?.length ?? 0;
    if (PR_URL.test(message.text)) prLinks += 1;
    if (REPO_PATH.test(message.text)) repoPaths += 1;
  }
  let score = 0;
  for (const kind of Object.keys(tools) as DevToolKind[]) score += Math.min(2, tools[kind]) * WEIGHT[kind];
  score += Math.min(2, repoPaths);
  score += Math.min(2, codeBlocks);
  score += Math.min(1, prLinks) * 3;
  if (computerActive) score += 1;
  if (explicit) score += ENTER_SCORE;
  return { score, tools, repoPaths, codeBlocks, prLinks };
}

export interface DevModeState {
  active: boolean;
  /** Evaluations in a row under EXIT_SCORE while active. */
  quiet: number;
}

export const DEV_MODE_OFF: DevModeState = { active: false, quiet: 0 };

/** One evaluation of the hysteresis. */
export function devModeStep(previous: DevModeState, score: number): DevModeState {
  if (!previous.active) return score >= ENTER_SCORE ? { active: true, quiet: 0 } : previous;
  if (score >= EXIT_SCORE) return previous.quiet === 0 ? previous : { active: true, quiet: 0 };
  const quiet = previous.quiet + 1;
  return quiet >= EXIT_STREAK ? DEV_MODE_OFF : { active: true, quiet };
}
