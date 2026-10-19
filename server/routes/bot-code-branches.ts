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
// action is refused with `github_not_connected`). On an organization
// server a request with no person is refused (`no_person`), never run with
// the server's identity, and no answer carries a full server path.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { CodeWorkCollector, type CodeWorkToolCall, type RepositoryInfo } from "../activity-code-work.ts";
import { BranchActionError, BranchArchive, BranchGit, BranchPulls, folderName, githubRepo, hostGit, proposedMessage, redactPaths, validBranchName, type GitExec } from "../code-branches.ts";
import type { BotBranchActionBody, BotBranchInfo, BotBranchState } from "../../shared/bot-code-branches.ts";

export interface BranchTask {
  threadId: string;
  title: string;
  cwd?: string | null;
}

/** What the person's git work runs with. */
export interface BranchCredentials {
  /** An organization server: git and gh see no home, ssh agent or config
   * of the server's. */
  isolated?: boolean;
  /** Every git call (never a token). */
  git: Record<string, string>;
  /** The commit's author: the person. Required on an organization server. */
  author?: { name: string; email: string };
  /** Their GitHub token: `push` for the push call only, `gh` for gh. Absent:
   * not connected, and push and pull requests are refused. */
  publish?: { push: Record<string, string>; gh: Record<string, string> };
}

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
    // Only a branch the thread itself worked on (never the folder's
    // checked-out branch just because it is there: often the default one).
    const known = work.branches.some((entry) => entry.name === branch)
      || work.commits.some((entry) => entry.branch === branch);
    return known ? { task, repository } : null;
  }

  /** On an organization server, a state with the worktree's folder name only. */
  function shown(state: BotBranchState): BotBranchState {
    return deps.organization() && state.worktree ? { ...state, worktree: folderName(state.worktree) } : state;
  }

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const archived = path.match(/^\/api\/bots\/([\w-]+)\/code\/branches\/archived$/);
    const single = path.match(/^\/api\/bots\/([\w-]+)\/code\/branch(?:\/(diff|pull|commit|push|pr|delete))?$/);
    if (!archived && !single) return PASS;
    const bot = deps.bot((archived ?? single)![1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const viewerId = deps.viewerId(auth);
    // An organization server acts only for a known person, never as itself.
    if (deps.organization() && !viewerId) return json(res, 403, { error: "Sign in as yourself to act on a branch here.", code: "no_person" });
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

    const organization = deps.organization();
    const credentials = deps.credentials(viewerId);
    const isolated = organization || credentials.isolated === true;
    const git = new BranchGit(exec, { root: repository.root, branch }, { env: credentials.git, pushEnv: credentials.publish?.push, isolated });
    const origin = await git.originUrl();
    const repo = githubRepo(origin);
    const publish = credentials.publish;
    const publishBlocked: BotBranchInfo["publishBlocked"] = !publish ? "github_not_connected" : undefined;
    const target = { botId: bot.id, branch, ...(repository.origin?.repo ? { repo: repository.origin.repo } : {}) };

    try {
      if (!action) {
        // On an organization server a server path means nothing to the
        // person: the folder's name only.
        const state = shown(await git.state());
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
        if (!publish) return json(res, 200, { pull: null, reason: "github_not_connected" });
        const pull = await new BranchPulls(exec, repository.root, repo, { ...credentials.git, ...publish.gh }, isolated).find(branch);
        return json(res, 200, { pull: pull ?? null });
      }
      if (!ACTIONS.has(action)) return json(res, 404, { error: "no such action" });

      if (action === "commit") {
        const paths = Array.isArray(body.paths) ? body.paths.filter((entry): entry is string => typeof entry === "string").slice(0, 500) : undefined;
        const message = typeof body.message === "string" ? body.message : "";
        const author = credentials.author;
        if (organization && !(author?.name.trim() && author.email.trim())) return json(res, 403, { error: "Your name and email are needed to sign a commit here. Add them to your profile first.", code: "no_author" });
        const { sha } = await git.commit(message, paths, author);
        deps.audit(auth, "code.branch.commit", target, { sha: sha.slice(0, 12), files: paths?.length ?? "all" });
        return json(res, 200, { ok: true, sha, state: shown(await git.state()) });
      }
      if (action === "push") {
        if (!publish) return json(res, 403, { error: "Connect your own GitHub account to push from here (Connect apps, Personal). The server's credentials are never used for you.", code: "github_not_connected" });
        if (organization && !repo) return json(res, 409, { error: "On this server, a branch is pushed only to an https GitHub remote, with your own GitHub connection.", code: "not_github" });
        const { remote } = await git.push(organization ? repo : undefined);
        deps.audit(auth, "code.branch.push", target, { remote });
        return json(res, 200, { ok: true, remote, state: shown(await git.state()) });
      }
      if (action === "pr") {
        if (!repo) return json(res, 409, { error: "Pull requests are opened on GitHub only, and this repository's origin is not on GitHub.", code: "not_github" });
        if (!publish) return json(res, 403, { error: "Connect your own GitHub account to open a pull request from here (Connect apps, Personal).", code: "github_not_connected" });
        const state = await git.state();
        if (state.isDefault) return json(res, 409, { error: "The default branch is not proposed from here.", code: "default_branch" });
        if (!state.pushed) return json(res, 409, { error: "Push the branch first: GitHub has no commits for it yet.", code: "not_pushed" });
        const subjects = await git.subjects(await git.base());
        const pull = await new BranchPulls(exec, repository.root, repo, { ...credentials.git, ...publish.gh }, isolated).open(branch, subjects, task.title);
        deps.audit(auth, "code.branch.pull_request", target, { number: pull.number, url: pull.url });
        return json(res, 200, { ok: true, pull, state: shown(state) });
      }
      // delete
      await git.deleteLocal(body.confirmUnpushed === true);
      deps.audit(auth, "code.branch.delete", target, { confirmedUnpushed: body.confirmUnpushed === true });
      return json(res, 200, { ok: true });
    } catch (error) {
      if (error instanceof BranchActionError) return json(res, error.status, { error: organization ? redactPaths(error.message) : error.message, code: error.code });
      return json(res, 500, { error: "git failed on this branch." });
    }
  };
}
