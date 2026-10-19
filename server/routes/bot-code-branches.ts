// The bot panel's Coding branches, acted on by the person (Details >
// Coding): read a branch now, commit, push, open a pull request, read its
// diff, delete the local branch, archive it in the person's own list.
//
//   GET  /api/bots/:id/code/branch?threadId=&branch=        state, place, proposed message
//   GET  /api/bots/:id/code/branch/diff?threadId=&branch=   its diff against its base
//   GET  /api/bots/:id/code/branch/pull?threadId=&branch=   its pull request on GitHub, if any
//   POST /api/bots/:id/code/branch/(commit|push|pr|delete)  { threadId, branch, ... }
//   GET  /api/bots/:id/code/branches/archived               the person's archived keys
//   POST /api/bots/:id/code/branches/archived               { key, archived }
//
// Where: the repository of the coding thread the branch came from, which is
// the thread's own folder (`cwd`) when that is a git repository on this
// server (server/activity-code-work.ts). A branch whose repository is
// elsewhere (the person's sandbox, a Local VM, their own computer) is read
// as `place: "elsewhere"` and nothing runs.
//
// Who: the person whose panel it is. The thread must be one they may post
// in (thread.post; not theirs reads exactly like not there), and the branch
// must be one that thread worked on. Their own work on their own branch
// asks no approval. Push and pull requests use their own credentials: on a
// solo server the server is their computer (their git and gh sign-in); on
// an organization server only their own GitHub connection, never the
// server's or the organization's (`credentials` returns none and the
// action is refused with `github_not_connected`).
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { CodeWorkCollector, type CodeWorkToolCall, type RepositoryInfo } from "../activity-code-work.ts";
import { BranchActionError, BranchArchive, BranchGit, BranchPulls, githubRepo, hostGit, proposedMessage, stripCredentials, validBranchName, type GitExec } from "../code-branches.ts";
import type { BotBranchActionBody, BotBranchInfo } from "../../shared/bot-code-branches.ts";

export interface BranchTask {
  threadId: string;
  title: string;
  cwd?: string | null;
}

/** The person's credentials for publishing, or why there are none. */
export type BranchCredentials =
  | { ok: true; git: Record<string, string>; gh: Record<string, string>; author?: { name: string; email: string } }
  | { ok: false; reason: "github_not_connected" };

export interface BotCodeBranchRouteDeps {
  bot(id: string): { id: string; name: string } | null | undefined;
  tasks(botId: string): BranchTask[];
  /** undefined on a solo server or for the operator. */
  viewerId(auth: RequestAuth): string | undefined;
  /** The viewer may post in that thread (thread.post). */
  threadWritable(botId: string, threadId: string, viewerId: string | undefined): boolean;
  messages(threadId: string, limit: number): { messages: Array<{ at: number; tool?: CodeWorkToolCall }> };
  repository(cwd: string): RepositoryInfo | undefined;
  organization(): boolean;
  credentials(viewerId: string | undefined): BranchCredentials;
  archive: BranchArchive;
  /** One line in the admin activity log (who, what, which branch). */
  audit(auth: RequestAuth, action: string, target: { botId: string; branch: string; repo?: string }, after?: Record<string, unknown>): void;
  exec?: GitExec;
}

const SCAN = 500;
const ACTIONS = new Set(["commit", "push", "pr", "delete"]);

export function createBotCodeBranchRoutes(deps: BotCodeBranchRouteDeps): RouteHandler {
  const exec = deps.exec ?? hostGit;

  /** The branch's repository, if the thread worked on that branch there. */
  function resolve(botId: string, threadId: string, branch: string, viewerId: string | undefined): { task: BranchTask; repository?: RepositoryInfo } | null {
    const task = deps.tasks(botId).find((entry) => entry.threadId === threadId);
    if (!task || !deps.threadWritable(botId, threadId, viewerId)) return null;
    const repository = task.cwd ? deps.repository(task.cwd) : undefined;
    const collector = new CodeWorkCollector(repository?.origin);
    for (const message of deps.messages(threadId, SCAN).messages) if (message.tool) collector.add(message.tool, message.at);
    const work = collector.result();
    const known = repository?.branch === branch
      || work.branches.some((entry) => entry.name === branch)
      || work.commits.some((entry) => entry.branch === branch);
    return known ? { task, repository } : null;
  }

  function folderName(root: string): string {
    return root.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? root;
  }

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const archived = path.match(/^\/api\/bots\/([\w-]+)\/code\/branches\/archived$/);
    const single = path.match(/^\/api\/bots\/([\w-]+)\/code\/branch(?:\/(diff|pull|commit|push|pr|delete))?$/);
    if (!archived && !single) return PASS;
    const bot = deps.bot((archived ?? single)![1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const viewerId = deps.viewerId(auth);
    const person = viewerId ?? "owner";

    if (archived) {
      if (method === "GET") return json(res, 200, { keys: deps.archive.list(person, bot.id) });
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req) as { key?: unknown; archived?: unknown } | undefined;
      const key = typeof body?.key === "string" ? body.key : "";
      if (!key || key.length > 600) return json(res, 400, { error: "key is required" });
      const keys = deps.archive.set(person, bot.id, key, body?.archived !== false);
      deps.audit(auth, body?.archived === false ? "code.branch.unarchive" : "code.branch.archive", { botId: bot.id, branch: key });
      return json(res, 200, { keys });
    }

    const action = single![2];
    const reading = !action || action === "diff" || action === "pull";
    if (reading ? method !== "GET" : method !== "POST") return json(res, 405, { error: "method not allowed" });
    const body: Partial<BotBranchActionBody> = reading
      ? { threadId: url.searchParams.get("threadId") ?? "", branch: url.searchParams.get("branch") ?? "" }
      : (await readBody(req) as Partial<BotBranchActionBody> | undefined) ?? {};
    const threadId = typeof body.threadId === "string" ? body.threadId : "";
    const branch = typeof body.branch === "string" ? body.branch : "";
    if (!threadId || !validBranchName(branch)) return json(res, 400, { error: "threadId and a valid branch are required" });
    const found = resolve(bot.id, threadId, branch, viewerId);
    if (!found) return json(res, 404, { error: "no such branch" });
    const { task, repository } = found;

    if (!repository) {
      if (!action) {
        const info: BotBranchInfo = { branch, place: "elsewhere", canPublish: false, publishBlocked: "elsewhere" };
        return json(res, 200, info);
      }
      return json(res, 409, { error: "This branch's repository is not on this server, so its actions run where the bot worked. Ask the bot to do it there.", code: "elsewhere" });
    }

    const credentials = deps.credentials(viewerId);
    const git = new BranchGit(exec, { root: repository.root, branch }, credentials.ok ? credentials.git : {});
    const origin = await git.originUrl();
    const repo = githubRepo(origin);
    const publishBlocked: BotBranchInfo["publishBlocked"] = !credentials.ok ? credentials.reason : undefined;
    const target = { botId: bot.id, branch, ...(repository.origin?.repo ? { repo: repository.origin.repo } : {}) };

    try {
      if (!action) {
        const read = await git.state();
        // On an organization server a server path means nothing to the
        // person: the folder's name only.
        const state = deps.organization() && read.worktree ? { ...read, worktree: folderName(read.worktree) } : read;
        const info: BotBranchInfo = {
          branch,
          place: "server",
          folderName: folderName(repository.root),
          ...(repository.origin?.repo ? { repo: repository.origin.repo } : {}),
          state,
          proposedMessage: proposedMessage(state.changes, task.title),
          canPublish: !publishBlocked,
          ...(publishBlocked ? { publishBlocked } : {}),
        };
        return json(res, 200, info);
      }
      if (action === "diff") return json(res, 200, await git.diff());
      if (action === "pull") {
        if (!repo) return json(res, 200, { pull: null, reason: "not_github" });
        if (!credentials.ok) return json(res, 200, { pull: null, reason: credentials.reason });
        const pull = await new BranchPulls(exec, repository.root, repo, credentials.gh).find(branch);
        return json(res, 200, { pull: pull ?? null });
      }
      if (!ACTIONS.has(action)) return json(res, 404, { error: "no such action" });

      if (action === "commit") {
        const paths = Array.isArray(body.paths) ? body.paths.filter((entry): entry is string => typeof entry === "string").slice(0, 500) : undefined;
        const message = typeof body.message === "string" ? body.message : "";
        const author = credentials.ok ? credentials.author : undefined;
        const { sha } = await git.commit(message, paths, author);
        deps.audit(auth, "code.branch.commit", target, { sha: sha.slice(0, 12), files: paths?.length ?? "all" });
        return json(res, 200, { ok: true, sha, state: await git.state() });
      }
      if (action === "push") {
        if (!credentials.ok) return json(res, 403, { error: "Connect your own GitHub account to push from here (Connect apps, Personal). The server's credentials are never used for you.", code: credentials.reason });
        if (deps.organization() && origin && !/^https:\/\/github\.com\//i.test(stripCredentials(origin))) {
          return json(res, 409, { error: "On this server, a branch is pushed only to an https GitHub remote, with your own GitHub connection.", code: "not_github" });
        }
        const { remote } = await git.push();
        deps.audit(auth, "code.branch.push", target, { remote });
        return json(res, 200, { ok: true, remote, state: await git.state() });
      }
      if (action === "pr") {
        if (!repo) return json(res, 409, { error: "Pull requests are opened on GitHub only, and this repository's origin is not on GitHub.", code: "not_github" });
        if (!credentials.ok) return json(res, 403, { error: "Connect your own GitHub account to open a pull request from here (Connect apps, Personal).", code: credentials.reason });
        const state = await git.state();
        if (state.isDefault) return json(res, 409, { error: "The default branch is not proposed from here.", code: "default_branch" });
        if (!state.pushed) return json(res, 409, { error: "Push the branch first: GitHub has no commits for it yet.", code: "not_pushed" });
        const pull = await new BranchPulls(exec, repository.root, repo, credentials.gh).open(branch, state.base);
        deps.audit(auth, "code.branch.pull_request", target, { number: pull.number, url: pull.url });
        return json(res, 200, { ok: true, pull, state });
      }
      // delete
      await git.deleteLocal(body.confirmUnpushed === true);
      deps.audit(auth, "code.branch.delete", target, { confirmedUnpushed: body.confirmUnpushed === true });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof BranchActionError) return json(res, error.status, { error: error.message, code: error.code });
      return json(res, 500, { error: "git failed on this branch." });
    }
  };
}
