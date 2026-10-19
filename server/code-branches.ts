// The bot panel's Coding branches, acted on by the person (Details >
// Coding: commit, push, open a pull request, diff, archive, delete). The
// git work runs where the repository is: a folder on this server (the
// thread's own `cwd` read by server/activity-code-work.ts), with the
// person's own credentials, never the server's or another person's
// (server/routes/bot-code-branches.ts picks them). Nothing here force
// pushes, rewrites history or touches the default branch.
//
// Every call goes through a `GitExec` (args, never a shell), so the tests
// drive a temporary repository and a bare local remote.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { parseUnifiedDiff } from "../shared/code-runs.ts";
import type { BotBranchChange, BotBranchPull, BotBranchState } from "../shared/bot-code-branches.ts";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitExec = (program: "git" | "gh", args: string[], options: { cwd: string; env?: Record<string, string>; timeoutMs?: number; maxBytes?: number; isolated?: boolean }) => Promise<GitResult>;

export class BranchActionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What git and gh may read from the server's environment: where they are,
 * the home folder (the person's git config, credential helper and gh login
 * on their own computer), the ssh agent, proxies and certificates. Nothing
 * else of the server's environment reaches them. Isolated (an organization
 * server): no home, ssh agent or config folder of the server's either. */
const ISOLATED_PASSTHROUGH = new Set(["PATH", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "LANG", "TMPDIR"]);
const PASSTHROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SSH_AUTH_SOCK", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_CONFIG_GLOBAL", "LANG", "TMPDIR", "XDG_CONFIG_HOME", "GH_CONFIG_DIR"] as const;

export const hostGit: GitExec = (program, args, options) => new Promise((done) => {
  const passthrough = Object.fromEntries(PASSTHROUGH.flatMap((key) => (process.env[key] && (!options.isolated || ISOLATED_PASSTHROUGH.has(key)) ? [[key, process.env[key]!]] : [])));
  execFile(program, args, {
    cwd: options.cwd,
    env: {
      PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
      ...passthrough,
      // never wait on a prompt nobody sees
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      GCM_INTERACTIVE: "never",
      LC_ALL: "C",
      ...options.env,
    },
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: options.maxBytes ?? 4 * 1024 * 1024,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
    const code = !failure ? 0 : typeof failure.code === "number" ? failure.code : failure.code === "ENOENT" ? 127 : 1;
    done({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? (failure?.message ?? "")) });
  });
});

/** A branch name the panel may act on: git's own rules, plus no leading
 * dash (never read as an option) and no `HEAD`. */
export function validBranchName(name: string): boolean {
  if (!name || name.length > 250 || name.startsWith("-") || name === "HEAD") return false;
  if (/[\s~^:?*[\\]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return false;
  if (name.includes("..") || name.includes("@{") || name.includes("//")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.endsWith(".") || name.endsWith(".lock")) return false;
  return name.split("/").every((part) => part.length > 0 && !part.startsWith("."));
}

/** One line of `git status --porcelain=v1 -z`, as a change. */
export function parseStatus(text: string): BotBranchChange[] {
  const out: BotBranchChange[] = [];
  const parts = text.split("\0");
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index]!;
    if (entry.length < 4) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const path = entry.slice(3);
    // A rename or copy carries its old path in the next field.
    const from = x === "R" || x === "C" ? parts[++index] : undefined;
    const code = x === "?" ? "?" : x !== " " ? x : y;
    const status: BotBranchChange["status"] = code === "?" ? "untracked" : code === "A" ? "added" : code === "D" ? "deleted" : code === "R" || code === "C" ? "renamed" : "modified";
    out.push({ path, status, ...(from ? { from } : {}) });
  }
  return out;
}

/** The default commit message for these changes when the thread gives
 * none: "Update a.ts, b.ts and 3 more". */
export function proposedMessage(changes: readonly BotBranchChange[], title?: string): string {
  const cleanTitle = title?.replace(/\s+/g, " ").trim();
  if (cleanTitle) return cleanTitle.slice(0, 72);
  if (!changes.length) return "Update";
  const names = changes.map((change) => change.path.split("/").at(-1) ?? change.path);
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `Update ${shown} and ${names.length - 2} more` : `Update ${shown}`;
}

export interface BranchPlace {
  /** The repository's root folder on this server. */
  root: string;
  branch: string;
}

/** Branch names never pushed, deleted or proposed from the panel, whatever
 * origin's HEAD says (or when it says nothing). */
export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set(["main", "master", "trunk", "develop"]);

/** What git runs with: `env` for every call; `pushEnv` (the person's
 * token) for the push call only; `isolated` on an organization server. */
export interface BranchGitEnv {
  env?: Record<string, string>;
  pushEnv?: Record<string, string>;
  isolated?: boolean;
}

/** Local or worktree git config the push never runs under on an
 * organization server: rewrites, proxies, TLS, extra headers, helpers. */
const UNSAFE_PUSH_CONFIG = /^(url\..*\.(insteadof|pushinsteadof)|http\..*(proxy|sslverify|sslcainfo|sslcapath|sslcert|sslkey|extraheader|cookiefile|emptyauth|curloptresolve)|remote\.origin\.(pushurl|proxy|receivepack|uploadpack)|core\.(sshcommand|gitproxy|askpass)|credential\..*|include\..*|includeif\..*)$/i;

/** The git calls for one branch of one repository. */
export class BranchGit {
  private readonly exec: GitExec;
  private readonly place: BranchPlace;
  private readonly env: Record<string, string>;
  private readonly pushEnv: Record<string, string>;
  private readonly isolated: boolean;
  constructor(exec: GitExec, place: BranchPlace, options: BranchGitEnv = {}) {
    this.exec = exec;
    this.place = place;
    this.env = options.env ?? {};
    this.pushEnv = options.pushEnv ?? {};
    this.isolated = options.isolated === true;
    if (!isAbsolute(place.root)) throw new BranchActionError("The repository folder is not known.", "no_folder", 404);
    if (!validBranchName(place.branch)) throw new BranchActionError("That branch name is not valid.", "invalid_branch", 400);
  }

  private async git(args: string[], cwd = this.place.root, options: { timeoutMs?: number; maxBytes?: number; env?: Record<string, string> } = {}): Promise<GitResult> {
    // Hooks and fsmonitor of the repository never run on the person's behalf
    // from the panel (the bot may have written them).
    return this.exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, env: { ...this.env, ...options.env }, timeoutMs: options.timeoutMs, maxBytes: options.maxBytes, ...(this.isolated ? { isolated: true } : {}) });
  }

  private async ok(args: string[], cwd?: string): Promise<string | undefined> {
    const result = await this.git(args, cwd);
    return result.code === 0 ? result.stdout.trim() : undefined;
  }

  private get ref(): string {
    return `refs/heads/${this.place.branch}`;
  }

  /** The worktree folder where the branch is checked out, if any. */
  async worktree(): Promise<string | undefined> {
    const list = await this.ok(["worktree", "list", "--porcelain"]);
    if (!list) return undefined;
    let path: string | undefined;
    for (const line of list.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice(9).trim();
      else if (line.trim() === `branch ${this.ref}` && path) return path;
    }
    return undefined;
  }

  /** origin's HEAD branch as this repository knows it (no network). */
  async originHead(): Promise<string | undefined> {
    const head = await this.ok(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    return head ? head.replace(/^refs\/remotes\/origin\//, "") : undefined;
  }

  /** The branch is the default one: origin's HEAD, or a protected name. */
  async isDefaultBranch(): Promise<boolean> {
    if (PROTECTED_BRANCHES.has(this.place.branch)) return true;
    return (await this.originHead()) === this.place.branch;
  }

  /** The base the branch would merge into: origin's HEAD, else main or master. */
  async base(): Promise<string | undefined> {
    const head = await this.originHead();
    if (head) return `origin/${head}`;
    for (const name of ["origin/main", "origin/master", "main", "master"]) {
      if (name.endsWith(`/${this.place.branch}`) || name === this.place.branch) continue;
      if (await this.ok(["rev-parse", "--verify", "--quiet", `${name.includes("/") ? "refs/remotes/" : "refs/heads/"}${name}^{commit}`])) return name;
    }
    return undefined;
  }

  async originUrl(): Promise<string | undefined> {
    return this.ok(["remote", "get-url", "origin"]);
  }

  async state(): Promise<BotBranchState> {
    const sha = await this.ok(["rev-parse", "--verify", "--quiet", `${this.ref}^{commit}`]);
    if (!sha) return { exists: false, ahead: 0, behind: 0, pushed: false, changes: [] };
    const worktree = await this.worktree();
    const remoteSha = await this.ok(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${this.place.branch}^{commit}`]);
    const base = await this.base();
    const defaultBranch = base?.replace(/^origin\//, "");
    const isDefault = await this.isDefaultBranch();
    let ahead = 0;
    let behind = 0;
    const against = remoteSha ? `refs/remotes/origin/${this.place.branch}` : base;
    if (against) {
      const counts = await this.ok(["rev-list", "--left-right", "--count", `${against}...${this.ref}`]);
      const [left, right] = (counts ?? "0 0").split(/\s+/).map(Number);
      behind = remoteSha ? left ?? 0 : 0;
      ahead = right ?? 0;
    }
    const changes = worktree && existsSync(worktree) ? parseStatus((await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree)).stdout).slice(0, 500) : [];
    const subject = await this.ok(["log", "-1", "--format=%s", this.ref]);
    return {
      exists: true,
      sha,
      ...(worktree ? { worktree } : {}),
      ...(defaultBranch ? { base: defaultBranch } : {}),
      isDefault,
      pushed: Boolean(remoteSha),
      ahead,
      behind,
      changes,
      ...(subject ? { lastCommit: subject.slice(0, 200) } : {}),
    };
  }

  /** Commit the branch's changes (all of them, or the listed paths) in the
   * worktree where it is checked out. */
  async commit(message: string, paths?: readonly string[], author?: { name: string; email: string }): Promise<{ sha: string }> {
    const text = message.trim();
    if (!text) throw new BranchActionError("Write a commit message first.", "empty_message", 400);
    if (text.length > 5_000) throw new BranchActionError("That commit message is too long.", "message_too_long", 400);
    const worktree = await this.worktree();
    if (!worktree) throw new BranchActionError("This branch is not checked out anywhere, so it has no changes to commit.", "not_checked_out");
    const changes = parseStatus((await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], worktree)).stdout);
    if (!changes.length) throw new BranchActionError("Nothing to commit on this branch.", "nothing_to_commit");
    const known = new Set(changes.map((change) => change.path));
    const picked = paths?.length ? paths.filter((path) => known.has(path)) : [...known];
    if (paths?.length && picked.length !== paths.length) throw new BranchActionError("Some of those files have no changes any more. Refresh and try again.", "stale_files");
    // A renamed file commits with its old path, or the old one stays behind.
    const renamedFrom = new Map(changes.flatMap((change) => (change.from ? [[change.path, change.from] as const] : [])));
    const chosen = [...new Set(picked.flatMap((path) => (renamedFrom.has(path) ? [path, renamedFrom.get(path)!] : [path])))];
    const add = await this.git(["add", "--all", "--", ...chosen.map((path) => `:(literal)${path}`)], worktree);
    if (add.code !== 0) throw new BranchActionError(firstLine(add.stderr) || "git could not stage those files.", "add_failed", 500);
    const identity: Record<string, string> = author ? { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email } : {};
    // The message goes through a file in a fresh private folder of the
    // server (GitExec carries no stdin, the argv never holds what the person
    // typed, and nothing the bot wrote in the repository can stand in for it).
    const folder = mkdtempSync(join(tmpdir(), "sagax-commit-"));
    const file = join(folder, "message");
    let done: GitResult;
    try {
      writeFileSync(file, `${text}\n`, { mode: 0o600, flag: "wx" });
      done = await this.git(["commit", "--no-verify", `--file=${file}`, "--", ...chosen.map((path) => `:(literal)${path}`)], worktree, { env: identity });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    if (done.code !== 0) throw new BranchActionError(firstLine(done.stderr) || firstLine(done.stdout) || "git could not commit.", "commit_failed", 500);
    const sha = await this.ok(["rev-parse", "HEAD"], worktree);
    return { sha: sha ?? "" };
  }

  /** Push the branch to origin under the same name, never forced, never
   * the default branch. `githubRepo` (an organization server): origin must
   * be exactly https://github.com/<that repo>, for fetch and push, with no
   * local config that could reroute the push or read its token. */
  async push(githubRepoOnly?: string): Promise<{ remote: string }> {
    const state = await this.state();
    if (!state.exists) throw new BranchActionError("This branch no longer exists here.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.place.branch)) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    const remote = await this.originUrl();
    if (!remote) throw new BranchActionError("This repository has no origin remote to push to.", "no_remote");
    if (githubRepoOnly) {
      const expected = new Set([`https://github.com/${githubRepoOnly}`, `https://github.com/${githubRepoOnly}.git`].map((url) => url.toLowerCase()));
      const pushUrl = await this.ok(["remote", "get-url", "--push", "origin"]);
      if (!expected.has(remote.toLowerCase()) || !pushUrl || !expected.has(pushUrl.toLowerCase())) throw new BranchActionError("On this server, a branch is pushed only to its https GitHub remote.", "not_github");
      const config = (await this.git(["config", "--list", "--show-scope", "--name-only"])).stdout.split("\n");
      if (config.some((line) => /^(local|worktree)\t/.test(line) && UNSAFE_PUSH_CONFIG.test(line.split("\t")[1] ?? ""))) throw new BranchActionError("This repository's git config changes how it pushes, so it is not pushed from here.", "unsafe_config");
    }
    // The remote's own default branch, read with the push itself: never that one.
    const remoteHead = await this.git(["ls-remote", "--symref", "origin", "HEAD"], this.place.root, { timeoutMs: 60_000, env: this.pushEnv });
    if (remoteHead.code === 0) {
      const head = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(remoteHead.stdout)?.[1];
      if (head === this.place.branch) throw new BranchActionError("The default branch is not pushed from here.", "default_branch");
    } else if (githubRepoOnly) {
      throw pushError(remoteHead.stderr || remoteHead.stdout);
    }
    const result = await this.git(["push", "--porcelain", "--set-upstream", "origin", `${this.ref}:${this.ref}`], this.place.root, { timeoutMs: 120_000, env: this.pushEnv });
    if (result.code !== 0) throw pushError(result.stderr || result.stdout);
    return { remote: stripCredentials(remote) };
  }

  /** The branch's changes against its base (committed work), plus what is
   * not committed yet in its worktree. */
  async diff(maxBytes = 2 * 1024 * 1024): Promise<{ files: ReturnType<typeof parseUnifiedDiff>; truncated: boolean; base?: string }> {
    const base = await this.base();
    const worktree = await this.worktree();
    const mergeBase = base ? await this.ok(["merge-base", base, this.ref]) : undefined;
    const args = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"];
    const result = worktree
      ? await this.git([...args, mergeBase ?? "HEAD"], worktree, { maxBytes: maxBytes * 2 })
      : await this.git([...args, mergeBase ? `${mergeBase}..${this.ref}` : `${this.ref}^..${this.ref}`], this.place.root, { maxBytes: maxBytes * 2 });
    if (result.code !== 0 && !result.stdout) throw new BranchActionError(firstLine(result.stderr) || "git could not read the diff.", "diff_failed", 500);
    const truncated = result.stdout.length > maxBytes;
    const text = truncated ? result.stdout.slice(0, result.stdout.lastIndexOf("\ndiff --git", maxBytes) > 0 ? result.stdout.lastIndexOf("\ndiff --git", maxBytes) : maxBytes) : result.stdout;
    return { files: parseUnifiedDiff(text), truncated, ...(base ? { base: base.replace(/^origin\//, "") } : {}) };
  }

  /** Delete the local branch. A branch with work that is not on origin
   * needs `unpushed` (the person confirmed twice); the remote branch, the
   * worktree folder and the pull request stay. */
  async deleteLocal(unpushed: boolean): Promise<void> {
    const state = await this.state();
    if (!state.exists) throw new BranchActionError("This branch no longer exists here.", "gone", 404);
    if (state.isDefault || PROTECTED_BRANCHES.has(this.place.branch)) throw new BranchActionError("The default branch is never deleted from here.", "default_branch");
    if (state.worktree) throw new BranchActionError(`This branch is checked out in ${this.isolated ? folderName(state.worktree) : state.worktree}. Remove that worktree first; the panel never deletes a folder.`, "checked_out");
    const unsaved = !state.pushed || state.ahead > 0;
    if (unsaved && !unpushed) throw new BranchActionError("This branch has commits that are not pushed. Confirm twice to delete it anyway.", "unpushed");
    const result = await this.git(["branch", unsaved ? "-D" : "-d", "--", this.place.branch]);
    if (result.code !== 0) {
      if (/not fully merged/i.test(result.stderr)) {
        const forced = await this.git(["branch", "-D", "--", this.place.branch]);
        if (forced.code === 0) return;
      }
      throw new BranchActionError(firstLine(result.stderr) || "git could not delete the branch.", "delete_failed", 500);
    }
  }
}

/** The last folder of a path: what an organization server shows of it. */
export function folderName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path;
}

/** A message without absolute server paths in it (each one becomes its
 * last folder): what an organization server says to a person. URLs stay. */
export function redactPaths(text: string): string {
  return text.replace(/(?<![\w:/.~-])(?:\/[^\s/'"`:]+){2,}\/?/g, (path) => folderName(path));
}

function firstLine(text: string): string {
  return stripCredentials(text.split("\n").map((line) => line.replace(/^(?:error|fatal|hint|remote): ?/i, "").trim()).find(Boolean) ?? "").slice(0, 300);
}

/** A remote address or message without a password or token in it. */
export function stripCredentials(text: string): string {
  return text.replace(/(\b[a-z][\w+.-]*:\/\/)[^/@\s]+@/gi, "$1").replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "***");
}

function pushError(text: string): BranchActionError {
  if (/rejected|non-fast-forward|fetch first/i.test(text)) return new BranchActionError("The remote branch has commits this one does not. Pull them first; nothing is forced from here.", "rejected");
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied|403|denied to/i.test(text)) return new BranchActionError("Your git credentials were refused for this repository. Sign in to GitHub with your own account and try again.", "auth", 403);
  if (/Could not resolve host|unable to access|timed out|Connection refused/i.test(text)) return new BranchActionError("The remote could not be reached.", "unreachable", 502);
  return new BranchActionError(firstLine(text) || "git could not push.", "push_failed", 500);
}

// ── pull requests (GitHub, through gh) ───────────────────────────────────

export type BranchPull = BotBranchPull;

/** owner/name of a GitHub remote, else undefined (pull requests are GitHub only). */
export function githubRepo(remote: string | undefined): string | undefined {
  if (!remote) return undefined;
  const scp = /^[\w.-]+@(github\.com):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote);
  if (scp) return scp[2];
  try {
    const url = new URL(remote);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return undefined;
    const parts = url.pathname.replace(/\.git\/?$/, "").split("/").filter(Boolean);
    return parts.length === 2 && parts.every((part) => /^[\w.-]+$/.test(part)) ? parts.join("/") : undefined;
  } catch {
    return undefined;
  }
}

export class BranchPulls {
  private readonly exec: GitExec;
  private readonly cwd: string;
  private readonly repo: string;
  private readonly env: Record<string, string>;
  private readonly isolated: boolean;
  constructor(exec: GitExec, cwd: string, repo: string, env: Record<string, string>, isolated = false) {
    this.exec = exec;
    this.cwd = cwd;
    this.repo = repo;
    this.env = env;
    this.isolated = isolated;
  }

  private async gh(args: string[]): Promise<GitResult> {
    return this.exec("gh", [...args, "--repo", this.repo], { cwd: this.cwd, env: this.env, timeoutMs: 60_000, ...(this.isolated ? { isolated: true } : {}) });
  }

  /** The newest pull request whose head is this branch, any state. */
  async find(branch: string): Promise<BranchPull | undefined> {
    const result = await this.gh(["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "number,url,state,title,isDraft"]);
    if (result.code === 127) throw new BranchActionError("The GitHub CLI (gh) is not installed where this repository is.", "no_gh", 501);
    if (result.code !== 0) throw ghError(result.stderr);
    try {
      const [pull] = JSON.parse(result.stdout) as Array<{ number: number; url: string; state: string; title?: string; isDraft?: boolean }>;
      if (!pull) return undefined;
      return { number: pull.number, url: pull.url, state: pull.state === "MERGED" ? "merged" : pull.state === "CLOSED" ? "closed" : "open", ...(pull.title ? { title: pull.title } : {}), ...(pull.isDraft ? { draft: true } : {}) };
    } catch {
      return undefined;
    }
  }

  /** Open a pull request from the branch into its base, titled from its
   * commits. The branch must be pushed. */
  async open(branch: string, base: string | undefined): Promise<BranchPull> {
    const existing = await this.find(branch);
    if (existing && existing.state === "open") return existing;
    const result = await this.gh(["pr", "create", "--head", branch, ...(base ? ["--base", base] : []), "--fill"]);
    if (result.code === 127) throw new BranchActionError("The GitHub CLI (gh) is not installed where this repository is.", "no_gh", 501);
    if (result.code !== 0) throw ghError(result.stderr);
    const url = /https:\/\/\S+\/pull\/(\d+)/.exec(result.stdout);
    if (!url) throw new BranchActionError("GitHub did not return the pull request's address.", "pr_failed", 502);
    return { number: Number(url[1]), url: url[0], state: "open" };
  }
}

function ghError(text: string): BranchActionError {
  if (/auth login|not logged|authentication|401|Bad credentials|GH_TOKEN/i.test(text)) return new BranchActionError("GitHub did not accept your sign-in. Connect your own GitHub account and try again.", "auth", 403);
  if (/must first push|not found on remote|No commits between|head sha can't be blank/i.test(text)) return new BranchActionError("Push the branch first: GitHub has no commits for it yet.", "not_pushed");
  return new BranchActionError(firstLine(text) || "GitHub refused the request.", "gh_failed", 502);
}

// ── archived branches, per person ────────────────────────────────────────

/** Branches a person archived in a bot's Coding list: hidden from the
 * list, the branch itself kept. Stored per person and bot in one JSON
 * file (mode 0600). Keys are `repo-or-folder:branch`. */
export class BranchArchive {
  private data: Record<string, Record<string, Record<string, number>>> = {};

  private readonly file: string;
  constructor(file: string) {
    this.file = file;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object") this.data = parsed as typeof this.data;
    } catch {
      this.data = {};
    }
  }

  list(person: string, botId: string): string[] {
    return Object.keys(this.data[person]?.[botId] ?? {});
  }

  set(person: string, botId: string, key: string, archived: boolean, now = Date.now()): string[] {
    if (!key || key.length > 600) throw new BranchActionError("That branch is not known.", "invalid_key", 400);
    const byBot = (this.data[person] ??= {});
    const keys = (byBot[botId] ??= {});
    if (archived) keys[key] = now;
    else delete keys[key];
    if (!Object.keys(keys).length) delete byBot[botId];
    if (!Object.keys(byBot).length) delete this.data[person];
    this.save();
    return this.list(person, botId);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
