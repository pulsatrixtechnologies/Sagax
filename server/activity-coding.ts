// Which of a bot's conversations are coding work, for the bot panel's Coding
// list (server/routes/bot-activity.ts). Read off what the conversation did,
// never its title: a coding job edited code files, ran version control
// (commit, push, a branch or worktree, a pull request), or changed files
// while it worked inside a repository. Writing the bot's own profile or
// memory files (SOUL.md, MEMORY.md, a skill) is not coding.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { isWriteTool } from "./thread-files.ts";

export interface CodingToolCall {
  name: string;
  summary?: string;
  input?: unknown;
  files?: string[];
  setup?: boolean;
}

export interface CodingSignals {
  /** Files written by an edit tool (profile files left out). */
  edits: number;
  /** Of those, source files (by extension or well-known name). */
  codeFiles: number;
  /** A commit, push, branch, worktree or pull request ran. */
  vcs: boolean;
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "swift", "kt", "kts",
  "java", "scala", "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "m", "mm", "cs", "fs", "php", "pl",
  "sh", "bash", "zsh", "ps1", "psm1", "sql", "css", "scss", "sass", "less", "html", "vue", "svelte",
  "astro", "dart", "lua", "r", "ex", "exs", "erl", "clj", "zig", "nim", "tf", "hcl", "gradle", "xcconfig",
  "pbxproj", "csproj", "sln", "proto", "graphql", "gql",
]);
const CODE_NAMES = new Set(["makefile", "dockerfile", "rakefile", "gemfile", "podfile", "cmakelists.txt", "package.json", "tsconfig.json", "cargo.toml", "go.mod", "pyproject.toml"]);
/** The bot's own instructions and memory: editing them is not coding. */
const PROFILE_NAMES = new Set(["soul.md", "identity.md", "memory.md", "user.md", "directive.md", "directives.md", "persona.md", "personality.md", "skill.md", "heartbeat.md", "tools.md"]);
/** The bot's own folder on the server (~/.sagax/bots/<id>/): its profile. */
const PROFILE_FOLDER = /(?:^|\/)\.(?:sagax|openmausbot)\/bots\//i;

// git or gh where a command starts (a line, or after ; && || | ( $( or a
// backtick), never inside prose: a request or a file's text that quotes
// "git push" is not version control.
const VCS_COMMAND = /(?:^|[;&|(`\n]|\$\()\s*(?:sudo\s+)?(?:git\s+(?:-C\s+\S+\s+)?(?:commit|push|merge|rebase|cherry-pick|worktree\s+add|checkout\s+-b|switch\s+-c)|gh\s+pr\s+(?:create|merge|edit|ready)\b)/m;
/** Claude's sub-agent tool (Task before it was renamed Agent): its input is
 * a request in words, never a command. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);
const VCS_TOOL = /(?:^|__|[_-])(?:create_pull_request|merge_pull_request|push_files|create_branch|create_or_update_file|create_commit)$/i;

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "";
}

export function isProfileFile(path: string): boolean {
  return PROFILE_NAMES.has(baseName(path)) || PROFILE_FOLDER.test(path.replace(/\\/g, "/"));
}

export function isCodeFile(path: string): boolean {
  const name = baseName(path);
  if (!name || isProfileFile(path)) return false;
  if (CODE_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE_EXTENSIONS.has(name.slice(dot + 1));
}

/** A shell command's text with heredoc bodies left out: what a heredoc
 * writes (a SOUL.md that quotes "git push") is data, not a command. */
function withoutHeredocs(text: string): string {
  return text
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, "")
    .replace(/<<-?\s*(['"]?)\w+\1[^\n]*\n[\s\S]*$/, "");
}

/** The command a tool call ran: its `command` field, from an object or the
 * JSON preview the chat kept (a preview cut short is unescaped by hand). */
function commandOf(input: unknown): string {
  if (Array.isArray(input)) return input.filter((part) => typeof part === "string").join(" ");
  if (input && typeof input === "object") return commandOf((input as { command?: unknown }).command);
  if (typeof input !== "string") return "";
  const text = input.trim();
  if (!text.startsWith("{")) return input;
  try {
    return commandOf(JSON.parse(text));
  } catch {
    const match = /"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    return match ? match[1]!.replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1") : "";
  }
}

function commandText(tool: CodingToolCall): string {
  return withoutHeredocs([tool.name, tool.summary, commandOf(tool.input)].filter(Boolean).join("\n"));
}

/** Adds one tool call to the signals so far (a scan can resume). */
export function addCodingSignal(signals: CodingSignals, tool: CodingToolCall): CodingSignals {
  if (tool.setup) return signals;
  // A sub-agent's request is words: what the sub-agent then did (its own
  // calls, nested under it) is read like any other call.
  if (!signals.vcs && !SUBAGENT_TOOLS.has(tool.name) && (VCS_TOOL.test(tool.name) || VCS_COMMAND.test(commandText(tool)))) signals.vcs = true;
  if (isWriteTool(tool.name)) {
    const files = (tool.files ?? []).filter((file) => !isProfileFile(file));
    // A write tool that names no file still changed something, unless it
    // named only profile files.
    if (files.length || !tool.files?.length) signals.edits += Math.max(files.length, 1);
    signals.codeFiles += files.filter(isCodeFile).length;
  }
  return signals;
}

export function codingSignals(tools: Iterable<CodingToolCall>): CodingSignals {
  const signals: CodingSignals = { edits: 0, codeFiles: 0, vcs: false };
  for (const tool of tools) addCodingSignal(signals, tool);
  return signals;
}

/** Coding work: version control ran, source files changed, or files
 * changed while the conversation worked inside a repository. */
export function isCodingWork(signals: CodingSignals, inRepository = false): boolean {
  return signals.vcs || signals.codeFiles > 0 || (inRepository && signals.edits > 0);
}

const repoCache = new Map<string, { at: number; inside: boolean }>();
const REPO_CACHE_MS = 60_000;

/** The folder is inside a git repository or worktree on this server (a
 * `.git` folder or file up the tree). A folder on another computer, or one
 * that is gone, is not. Cached a minute per folder. */
export function inGitRepository(cwd: string, now = Date.now()): boolean {
  if (!cwd || !isAbsolute(cwd)) return false;
  const cached = repoCache.get(cwd);
  if (cached && now - cached.at < REPO_CACHE_MS) return cached.inside;
  let inside = false;
  for (let dir = resolve(cwd), depth = 0; depth < 40; depth++) {
    if (existsSync(join(dir, ".git"))) { inside = true; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (repoCache.size > 500) repoCache.clear();
  repoCache.set(cwd, { at: now, inside });
  return inside;
}
