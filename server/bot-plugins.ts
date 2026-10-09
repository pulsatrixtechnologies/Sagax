// Claude Code plugins on a bot (the bot panel's Library > Plugins). Sagax
// fetches a marketplace (a git repository with .claude-plugin/marketplace.json)
// itself and copies the plugins the owner picks into the bot's own folder.
// Claude loads each enabled folder with `--plugin-dir`. Every other engine
// gets the same enabled skills and commands in the turn prompt
// (server/plugin-turn.ts). Nothing here goes through a bot's shell: on an
// organization server the host Bash is denied (withholdHostTools), so
// `claude plugin marketplace add` typed by a bot could never run there,
// whatever SAGAX_CLAUDE_ALLOW says.
//
// Rules:
//   - Per bot: DATA_DIR/bot-plugins/<botId>/{state.json, marketplaces/, plugins/}.
//   - Who: the bot's owner or a person with manage on it (the route checks);
//     reads need use. The organization admin may restrict marketplaces
//     (organization.pluginMarketplaces: any by default, or a list of
//     owner/repo, owner/* or exact https URLs).
//   - A private marketplace is read with, in order: the token saved for it
//     on this bot (server/marketplace-tokens.ts), the acting person's own
//     GitHub connection (server/github-connect.ts), then the organization's
//     GitHub tokens (server/github-access.ts). For github.com, GitHub's API
//     says first which one reads the repository, or why none does (404
//     private, 401 bad token, 403 SAML sign-on, rate limit). The token rides
//     an extra HTTP header through the environment, never the URL, the argv
//     or a file.
//   - What runs on the server host is never taken from a plugin: hooks,
//     MCP and LSP servers and bin/ are removed at install (they would run on
//     the Sagax host, outside every person's environment). The plugin's
//     skills, commands, agents and output styles stay. The MCP servers it
//     declared are listed so the person can add them as their own.
import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { probeGithubRepo, type GithubCredential, type GithubProbe } from "./github-access.ts";
import { githubGitEnvironment } from "./github-connect.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BOT_ID = /^[\w-]{1,80}$/;
const MAX_REPO_BYTES = 64 * 1024 * 1024;
const MAX_REPO_FILES = 8_000;
const MAX_MARKETPLACES = 10;
const MAX_PLUGINS = 50;
const GIT_TIMEOUT_MS = 120_000;
/** What a plugin may not bring onto the server host. */
const STRIPPED_PATHS = ["hooks", ".mcp.json", ".lsp.json", "bin", "monitors"] as const;
const STRIPPED_MANIFEST_KEYS = ["hooks", "mcpServers", "lspServers", "monitors"] as const;

export class BotPluginError extends Error {
  readonly code: string;
  readonly status: number;
  /** What the person can do (server/github-access.ts GithubAccessFix). */
  readonly fix?: string;
  constructor(message: string, code: string, status = 400, fix?: string) {
    super(message);
    this.code = code;
    this.status = status;
    if (fix) this.fix = fix;
  }
}

// ── sources and policy ───────────────────────────────────────────────────

export interface GitSource {
  /** How it is shown and matched: `owner/repo` for GitHub, else the URL. */
  id: string;
  url: string;
  github?: { owner: string; repo: string };
  ref?: string;
}

const GITHUB_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** owner/repo, a github.com URL, or another https git URL. */
export function parseGitSource(input: string, ref?: string): GitSource {
  const text = input.trim();
  if (ref !== undefined && (!REF.test(ref) || ref.includes(".."))) throw new BotPluginError("That branch or tag name is not valid.", "invalid_source");
  const short = /^([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(text);
  if (short && !text.includes("://")) {
    const [, owner, repo] = short;
    if (!GITHUB_PART.test(owner!) || !GITHUB_PART.test(repo!)) throw new BotPluginError("Use owner/repo, like anthropics/claude-plugins.", "invalid_source");
    return { id: `${owner}/${repo}`.toLowerCase(), url: `https://github.com/${owner}/${repo}.git`, github: { owner: owner!, repo: repo! }, ...(ref ? { ref } : {}) };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new BotPluginError("Use owner/repo or an https:// git address.", "invalid_source");
  }
  if (url.protocol !== "https:") throw new BotPluginError("Only https:// marketplaces can be added.", "invalid_source");
  if (url.username || url.password || url.search || url.hash) throw new BotPluginError("Put no credentials or query in the address: connect GitHub for private repositories.", "invalid_source");
  if (url.hostname.toLowerCase() === "github.com") {
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").split("/");
    if (parts.length !== 2 || !GITHUB_PART.test(parts[0]!) || !GITHUB_PART.test(parts[1]!)) throw new BotPluginError("Use https://github.com/owner/repo.", "invalid_source");
    return parseGitSource(`${parts[0]}/${parts[1]}`, ref);
  }
  const clean = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { id: clean.toLowerCase(), url: clean, ...(ref ? { ref } : {}) };
}

export type MarketplacePolicy = { mode: "any" } | { mode: "list"; allow: string[] };

export const marketplacePolicySchema = z.union([
  z.object({ mode: z.literal("any") }).strict(),
  z.object({ mode: z.literal("list"), allow: z.array(z.string().trim().min(1).max(300)).max(100) }).strict(),
]);

/** Normalize an admin's list entry: owner/repo, owner/*, or an https URL. */
export function normalizePolicyEntry(entry: string): string {
  const text = entry.trim();
  const wildcard = /^([^/\s:]+)\/\*$/.exec(text);
  if (wildcard) {
    if (!GITHUB_PART.test(wildcard[1]!)) throw new BotPluginError(`“${entry}” is not owner/* or owner/repo.`, "invalid_policy");
    return `${wildcard[1]!.toLowerCase()}/*`;
  }
  return parseGitSource(text).id;
}

export function marketplaceAllowed(policy: MarketplacePolicy | undefined, source: GitSource): boolean {
  if (!policy || policy.mode === "any") return true;
  return policy.allow.some((raw) => {
    let entry: string;
    try { entry = normalizePolicyEntry(raw); } catch { return false; }
    if (entry.endsWith("/*")) return Boolean(source.github) && source.id.startsWith(entry.slice(0, -1));
    return entry === source.id;
  });
}

// ── state ────────────────────────────────────────────────────────────────

const marketplaceRecord = z.object({
  source: z.string(),
  url: z.string(),
  ref: z.string().optional(),
  description: z.string().optional(),
  addedAt: z.number(),
  addedBy: z.string().optional(),
  updatedAt: z.number(),
}).strict();

const pluginRecord = z.object({
  name: z.string(),
  marketplace: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  enabled: z.boolean(),
  installedAt: z.number(),
  installedBy: z.string().optional(),
  updatedAt: z.number(),
  /** What was taken out at install (hooks, .mcp.json, ...). */
  removed: z.array(z.string()),
  /** MCP servers the plugin declared (names only). */
  declaredMcpServers: z.array(z.string()),
}).strict();

const stateSchema = z.object({
  version: z.literal(1),
  marketplaces: z.record(z.string(), marketplaceRecord),
  plugins: z.record(z.string(), pluginRecord),
}).strict();

export type PluginState = z.infer<typeof stateSchema>;
export type MarketplaceRecord = z.infer<typeof marketplaceRecord>;
export type InstalledBotPlugin = z.infer<typeof pluginRecord> & { key: string };

export interface MarketplacePluginEntry {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  /** Where its files are: inside the marketplace, or another repository. */
  source: { kind: "path"; path: string } | { kind: "git"; git: GitSource; path?: string };
}

export interface MarketplaceListing {
  name: string;
  source: string;
  /** A token is saved for this marketplace (never the token). */
  hasToken: boolean;
  description?: string;
  addedAt: number;
  updatedAt: number;
  plugins: Array<{ name: string; description?: string; version?: string; category?: string; installed: boolean; external: boolean }>;
}

// ── marketplace.json ─────────────────────────────────────────────────────

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;
}

/** Read a marketplace's manifest (`.claude-plugin/marketplace.json`). */
export function readMarketplaceManifest(root: string): { name: string; description?: string; plugins: MarketplacePluginEntry[] } {
  const file = join(root, ".claude-plugin", "marketplace.json");
  let raw: unknown;
  try {
    const stat = statSync(file);
    if (stat.size > 1_048_576) throw new Error("too large");
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new BotPluginError("This repository has no readable .claude-plugin/marketplace.json: it is not a Claude Code plugin marketplace.", "not_a_marketplace", 422);
  }
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const name = text(record.name, 64);
  if (!name || !NAME.test(name)) throw new BotPluginError("The marketplace has no valid name in marketplace.json.", "not_a_marketplace", 422);
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
  const pluginRoot = typeof metadata.pluginRoot === "string" ? metadata.pluginRoot : "";
  const description = text(metadata.description ?? record.description, 300);
  const plugins: MarketplacePluginEntry[] = [];
  for (const item of Array.isArray(record.plugins) ? record.plugins.slice(0, 500) : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const pluginName = text(entry.name, 64);
    if (!pluginName || !NAME.test(pluginName)) continue;
    let source: MarketplacePluginEntry["source"] | null = null;
    const raw = entry.source;
    if (typeof raw === "string") {
      const path = raw.startsWith("./") || raw.startsWith("../") || !pluginRoot ? raw : `${pluginRoot.replace(/\/+$/, "")}/${raw}`;
      source = { kind: "path", path };
    } else if (raw && typeof raw === "object") {
      const spec = raw as Record<string, unknown>;
      const ref = typeof spec.ref === "string" ? spec.ref : undefined;
      try {
        if (spec.source === "github" && typeof spec.repo === "string") source = { kind: "git", git: parseGitSource(spec.repo, ref), ...(typeof spec.path === "string" ? { path: spec.path } : {}) };
        else if ((spec.source === "url" || spec.source === "git") && typeof spec.url === "string") source = { kind: "git", git: parseGitSource(spec.url, ref), ...(typeof spec.path === "string" ? { path: spec.path } : {}) };
        else if (spec.source === "git-subdir" && typeof spec.url === "string" && typeof spec.path === "string") source = { kind: "git", git: parseGitSource(spec.url, ref), path: spec.path };
      } catch {
        source = null;
      }
    }
    if (!source) continue;
    plugins.push({
      name: pluginName,
      ...(text(entry.description, 300) ? { description: text(entry.description, 300) } : {}),
      ...(text(entry.version, 40) ? { version: text(entry.version, 40) } : {}),
      ...(text(entry.category, 40) ? { category: text(entry.category, 40) } : {}),
      source,
    });
  }
  return { name, ...(description ? { description } : {}), plugins };
}

/** A path inside `root`, or a refusal (no `..`, no absolute path). */
export function insideRoot(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(base, normalize(path));
  const rel = relative(base, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new BotPluginError("The plugin's path leaves its repository.", "invalid_plugin", 422);
  return target;
}

/** Walk a tree: refuse a repository too large to be a plugin marketplace. */
function measure(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        files += 1;
        bytes += lstatSync(path).size;
        if (files > MAX_REPO_FILES || bytes > MAX_REPO_BYTES) throw new BotPluginError("This repository is too large to be a plugin marketplace.", "too_large", 422);
      }
    }
  }
  return { bytes, files };
}

/** Copy one plugin without links, then take out what would run on the
 * server host. Returns what was removed and the MCP servers it declared. */
export function copySanitizedPlugin(from: string, to: string, marketplaceEntry?: Record<string, unknown>): { removed: string[]; declaredMcpServers: string[] } {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new BotPluginError("The plugin's folder is missing from its repository.", "invalid_plugin", 422);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: (path) => {
      const stat = lstatSync(path);
      return !stat.isSymbolicLink() && !path.split(sep).includes(".git");
    },
  });
  const removed: string[] = [];
  const declared = new Set<string>();
  const readJson = (file: string): Record<string, unknown> | null => {
    try { const value = JSON.parse(readFileSync(file, "utf8")) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
  };
  const mcpJson = readJson(join(to, ".mcp.json"));
  const mcpBlock = mcpJson && typeof mcpJson.mcpServers === "object" && mcpJson.mcpServers ? mcpJson.mcpServers as Record<string, unknown> : mcpJson;
  for (const name of Object.keys(mcpBlock ?? {})) declared.add(name);
  for (const path of STRIPPED_PATHS) {
    const target = join(to, path);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(path);
    }
  }
  const manifestPath = join(to, ".claude-plugin", "plugin.json");
  const manifest = readJson(manifestPath) ?? (marketplaceEntry ? { ...marketplaceEntry } : null);
  if (manifest) {
    delete manifest.source;
    for (const key of STRIPPED_MANIFEST_KEYS) {
      if (key in manifest) {
        if (key === "mcpServers" && manifest.mcpServers && typeof manifest.mcpServers === "object") for (const name of Object.keys(manifest.mcpServers)) declared.add(name);
        delete manifest[key];
        removed.push(`plugin.json ${key}`);
      }
    }
    mkdirSync(join(to, ".claude-plugin"), { recursive: true });
    writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return { removed, declaredMcpServers: [...declared].filter((name) => NAME.test(name)).slice(0, 50) };
}

// ── git ──────────────────────────────────────────────────────────────────

export type GitRunner = (args: string[], options: { cwd?: string; env: Record<string, string>; timeoutMs: number }) => Promise<void>;

/** What git may read from the server's own environment: its proxy and
 * certificate settings and the operator's git config, nothing else (the
 * server's keys never reach it). */
const GIT_PASSTHROUGH = ["PATH", "HOME", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_CONFIG_GLOBAL"] as const;

export const runGit: GitRunner = (args, options) => new Promise((resolvePromise, reject) => {
  const passthrough = Object.fromEntries(GIT_PASSTHROUGH.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])));
  execFile("git", args, {
    cwd: options.cwd,
    env: { PATH: "/usr/bin:/bin", HOME: "/tmp", ...passthrough, ...options.env },
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
  }, (error, _stdout, stderr) => {
    if (!error) return resolvePromise();
    const detail = String(stderr ?? "");
    if (/Authentication failed|could not read Username|terminal prompts disabled|Repository not found|403/i.test(detail)) {
      reject(new BotPluginError("The git host did not let Sagax read this repository. If it is private, connect GitHub in Connect apps (Personal), or add a token for this marketplace.", "repository_unreadable", 422, "connect_or_token"));
      return;
    }
    if (/Could not resolve host|unable to access|timed out|Connection refused/i.test(detail) || (error as { killed?: boolean }).killed) {
      reject(new BotPluginError("The repository could not be reached from the server.", "repository_unreachable", 502));
      return;
    }
    if (/Remote branch .* not found|couldn't find remote ref/i.test(detail)) {
      reject(new BotPluginError("That branch or tag does not exist in the repository.", "invalid_source", 422));
      return;
    }
    reject(new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422));
  });
});

// ── the store ────────────────────────────────────────────────────────────

export interface BotPluginsOptions {
  dataDir: string;
  git?: GitRunner;
  /** git environment for a clone without a credential of its own (and the
   * whole environment when `credentials` is absent): the acting person's
   * GitHub token for github.com (githubGitEnvironment), or none. */
  gitEnvironment: (actor: string | undefined) => Record<string, string>;
  /** GitHub credentials to try after the marketplace's own token: the
   * acting person's connection, then the organization's tokens. */
  credentials?: (input: { botId: string; source: GitSource; actor: string | undefined }) => GithubCredential[];
  /** Tokens saved per bot and marketplace (server/marketplace-tokens.ts). */
  tokens?: {
    get(botId: string, source: string): string | undefined;
    set(botId: string, source: string, token: string, addedBy?: string): void;
    remove(botId: string, source: string): boolean;
    sourcesFor(botId: string): Set<string>;
    forgetBot(botId: string): void;
  };
  /** GitHub's answer for a repository (tests stand in for api.github.com). */
  probe?: (repo: { owner: string; repo: string }, credentials: readonly GithubCredential[]) => Promise<GithubProbe>;
  policy: () => MarketplacePolicy | undefined;
  now?: () => number;
}

/** A token for a git host other than GitHub, as an extra header for that
 * origin only (basic auth, the token as the password). */
export function hostGitEnvironment(url: string, token: string | undefined): Record<string, string> {
  const base = githubGitEnvironment(undefined);
  if (!token) return base;
  const origin = new URL(url).origin;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { ...base, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

export class BotPlugins {
  private readonly options: BotPluginsOptions;
  private readonly git: GitRunner;
  private readonly now: () => number;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(options: BotPluginsOptions) {
    this.options = options;
    this.git = options.git ?? runGit;
    this.now = options.now ?? Date.now;
  }

  private root(botId: string): string {
    if (!BOT_ID.test(botId)) throw new BotPluginError("invalid bot", "invalid_bot");
    return join(this.options.dataDir, "bot-plugins", botId);
  }

  private read(botId: string): PluginState {
    try {
      return stateSchema.parse(JSON.parse(readFileSync(join(this.root(botId), "state.json"), "utf8")));
    } catch {
      return { version: 1, marketplaces: {}, plugins: {} };
    }
  }

  private write(botId: string, state: PluginState): void {
    mkdirSync(this.root(botId), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root(botId), "state.json"), JSON.stringify(stateSchema.parse(state), null, 2));
  }

  private withLock<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(botId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.locks.set(botId, next.catch(() => undefined));
    return next;
  }

  /** The git environment that reads `source` for this bot, or the reason
   * nothing can. `marketplaceSource` names whose saved token applies (a
   * plugin in another repository uses its marketplace's token). */
  private async cloneEnvironment(botId: string, source: GitSource, actor: string | undefined, options: { token?: string; marketplaceSource?: string }): Promise<Record<string, string>> {
    const saved = options.token ?? this.options.tokens?.get(botId, options.marketplaceSource ?? source.id);
    if (!source.github) return saved ? hostGitEnvironment(source.url, saved) : this.options.gitEnvironment(undefined);
    if (!this.options.credentials && !saved) return this.options.gitEnvironment(actor);
    const credentials: GithubCredential[] = [
      ...(saved ? [{ token: saved, via: "marketplace" as const }] : []),
      ...(this.options.credentials?.({ botId, source, actor }) ?? []),
    ];
    const probe = await (this.options.probe ?? ((repo, list) => probeGithubRepo(repo, list)))(source.github, credentials);
    if (probe.ok === false) throw new BotPluginError(probe.failure.message, probe.failure.code, probe.failure.status, probe.failure.fix);
    return githubGitEnvironment(probe.credential?.token);
  }

  private async clone(source: GitSource, into: string, env: Record<string, string>): Promise<void> {
    const staging = `${into}.tmp-${process.pid}-${this.now()}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, ".."), { recursive: true });
    try {
      await this.git(["clone", "--depth", "1", "--single-branch", "--no-tags", ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, staging], {
        env, timeoutMs: GIT_TIMEOUT_MS,
      });
      measure(staging);
      rmSync(into, { recursive: true, force: true });
      renameSync(staging, into);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  private checkPolicy(source: GitSource): void {
    if (!marketplaceAllowed(this.options.policy(), source)) {
      throw new BotPluginError(`Your organization does not allow plugins from ${source.id}. An administrator can add it in Settings > Organization > Marketplaces autorisés.`, "marketplace_not_allowed", 403);
    }
  }

  /** The bot's marketplaces with what each offers. */
  listMarketplaces(botId: string): MarketplaceListing[] {
    const state = this.read(botId);
    let tokenSources = new Set<string>();
    try { tokenSources = this.options.tokens?.sourcesFor(botId) ?? new Set(); } catch { /* listed without the flag */ }
    return Object.entries(state.marketplaces).map(([name, record]) => {
      let plugins: MarketplaceListing["plugins"] = [];
      try {
        plugins = readMarketplaceManifest(join(this.root(botId), "marketplaces", name)).plugins.map((entry) => ({
          name: entry.name,
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.version ? { version: entry.version } : {}),
          ...(entry.category ? { category: entry.category } : {}),
          installed: Object.hasOwn(state.plugins, `${entry.name}@${name}`),
          external: entry.source.kind === "git",
        }));
      } catch {
        plugins = [];
      }
      return { name, source: record.source, hasToken: tokenSources.has(record.source), ...(record.description ? { description: record.description } : {}), addedAt: record.addedAt, updatedAt: record.updatedAt, plugins };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  listPlugins(botId: string): InstalledBotPlugin[] {
    return Object.entries(this.read(botId).plugins).map(([key, record]) => ({ key, ...record })).sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Add (or refresh) a marketplace by its source. A `token` is tried
   * first and saved for this marketplace once the clone works. */
  addMarketplace(botId: string, input: { source: string; ref?: string; token?: string }, actor: string | undefined): Promise<MarketplaceListing> {
    return this.withLock(botId, async () => {
      const source = parseGitSource(input.source, input.ref || undefined);
      this.checkPolicy(source);
      const state = this.read(botId);
      const existing = Object.entries(state.marketplaces).find(([, record]) => record.source === source.id && (record.ref ?? "") === (source.ref ?? ""));
      if (!existing && Object.keys(state.marketplaces).length >= MAX_MARKETPLACES) throw new BotPluginError(`A bot can have at most ${MAX_MARKETPLACES} marketplaces.`, "too_many", 400);
      const staging = join(this.root(botId), "marketplaces", `.incoming-${this.now()}`);
      if (input.token && !this.options.tokens) throw new BotPluginError("This server cannot keep marketplace tokens.", "tokens_unavailable", 503);
      await this.clone(source, staging, await this.cloneEnvironment(botId, source, actor, input.token ? { token: input.token } : {}));
      try {
        const manifest = readMarketplaceManifest(staging);
        const taken = state.marketplaces[manifest.name];
        if (taken && taken.source !== source.id) throw new BotPluginError(`This bot already has a marketplace named ${manifest.name} from ${taken.source}.`, "name_taken", 409);
        const target = join(this.root(botId), "marketplaces", manifest.name);
        rmSync(target, { recursive: true, force: true });
        renameSync(staging, target);
        const now = this.now();
        state.marketplaces[manifest.name] = {
          source: source.id, url: source.url, ...(source.ref ? { ref: source.ref } : {}), ...(manifest.description ? { description: manifest.description } : {}),
          addedAt: taken?.addedAt ?? now, ...(taken?.addedBy ?? actor ? { addedBy: taken?.addedBy ?? actor } : {}), updatedAt: now,
        };
        this.write(botId, state);
        if (input.token) this.options.tokens!.set(botId, source.id, input.token, actor);
        return this.listMarketplaces(botId).find((listing) => listing.name === manifest.name)!;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    });
  }

  /** Pull a marketplace again (its plugins' new versions are offered; the
   * installed ones change only on their own update). */
  updateMarketplace(botId: string, name: string, actor: string | undefined): Promise<MarketplaceListing> {
    const record = this.read(botId).marketplaces[name];
    if (!record) return Promise.reject(new BotPluginError("No marketplace with that name on this bot.", "not_found", 404));
    return this.addMarketplace(botId, { source: record.source.includes("://") ? record.url : record.source, ...(record.ref ? { ref: record.ref } : {}) }, actor);
  }

  removeMarketplace(botId: string, name: string): Promise<void> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      if (!state.marketplaces[name]) throw new BotPluginError("No marketplace with that name on this bot.", "not_found", 404);
      for (const [key, plugin] of Object.entries(state.plugins)) {
        if (plugin.marketplace !== name) continue;
        rmSync(this.pluginDir(botId, plugin.marketplace, plugin.name), { recursive: true, force: true });
        delete state.plugins[key];
      }
      const source = state.marketplaces[name]!.source;
      delete state.marketplaces[name];
      rmSync(join(this.root(botId), "marketplaces", name), { recursive: true, force: true });
      this.write(botId, state);
      if (!Object.values(state.marketplaces).some((record) => record.source === source)) {
        try { this.options.tokens?.remove(botId, source); } catch { /* the marketplace is gone either way */ }
      }
    });
  }

  private pluginDir(botId: string, marketplace: string, plugin: string): string {
    if (!NAME.test(marketplace) || !NAME.test(plugin)) throw new BotPluginError("invalid plugin", "invalid_plugin");
    return join(this.root(botId), "plugins", marketplace, plugin);
  }

  /** Install (or update) one plugin of a marketplace this bot has. */
  install(botId: string, input: { marketplace: string; plugin: string }, actor: string | undefined): Promise<InstalledBotPlugin> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      const market = state.marketplaces[input.marketplace];
      if (!market) throw new BotPluginError("Add the marketplace to this bot first.", "not_found", 404);
      const key = `${input.plugin}@${input.marketplace}`;
      if (!state.plugins[key] && Object.keys(state.plugins).length >= MAX_PLUGINS) throw new BotPluginError(`A bot can have at most ${MAX_PLUGINS} plugins.`, "too_many", 400);
      const marketRoot = join(this.root(botId), "marketplaces", input.marketplace);
      const manifest = readMarketplaceManifest(marketRoot);
      const entry = manifest.plugins.find((candidate) => candidate.name === input.plugin);
      if (!entry) throw new BotPluginError("That plugin is not in this marketplace.", "not_found", 404);
      const rawEntry = (() => {
        try {
          const all = JSON.parse(readFileSync(join(marketRoot, ".claude-plugin", "marketplace.json"), "utf8")) as { plugins?: Array<Record<string, unknown>> };
          return all.plugins?.find((candidate) => candidate.name === input.plugin);
        } catch { return undefined; }
      })();
      const target = this.pluginDir(botId, input.marketplace, input.plugin);
      let result: { removed: string[]; declaredMcpServers: string[] };
      if (entry.source.kind === "path") {
        result = copySanitizedPlugin(insideRoot(marketRoot, entry.source.path), target, rawEntry);
      } else {
        this.checkPolicy(entry.source.git);
        const checkout = join(this.root(botId), "plugins", ".checkout");
        await this.clone(entry.source.git, checkout, await this.cloneEnvironment(botId, entry.source.git, actor, { marketplaceSource: market.source }));
        try {
          result = copySanitizedPlugin(entry.source.path ? insideRoot(checkout, entry.source.path) : checkout, target, rawEntry);
        } finally {
          rmSync(checkout, { recursive: true, force: true });
        }
      }
      const now = this.now();
      const previous = state.plugins[key];
      state.plugins[key] = {
        name: input.plugin, marketplace: input.marketplace,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.version ? { version: entry.version } : {}),
        enabled: previous?.enabled ?? true,
        installedAt: previous?.installedAt ?? now,
        ...(previous?.installedBy ?? actor ? { installedBy: previous?.installedBy ?? actor } : {}),
        updatedAt: now,
        removed: result.removed,
        declaredMcpServers: result.declaredMcpServers,
      };
      this.write(botId, state);
      return { key, ...state.plugins[key]! };
    });
  }

  setEnabled(botId: string, key: string, enabled: boolean): InstalledBotPlugin {
    const state = this.read(botId);
    const record = state.plugins[key];
    if (!record) throw new BotPluginError("No plugin with that name on this bot.", "not_found", 404);
    state.plugins[key] = { ...record, enabled };
    this.write(botId, state);
    return { key, ...state.plugins[key]! };
  }

  uninstall(botId: string, key: string): Promise<void> {
    return this.withLock(botId, async () => {
      const state = this.read(botId);
      const record = state.plugins[key];
      if (!record) throw new BotPluginError("No plugin with that name on this bot.", "not_found", 404);
      rmSync(this.pluginDir(botId, record.marketplace, record.name), { recursive: true, force: true });
      delete state.plugins[key];
      this.write(botId, state);
    });
  }

  /** Enabled plugin folders. Claude loads them with `--plugin-dir`. */
  pluginDirs(botId: string): string[] {
    if (!BOT_ID.test(botId)) return [];
    return this.listPlugins(botId)
      .filter((plugin) => plugin.enabled)
      .map((plugin) => this.pluginDir(botId, plugin.marketplace, plugin.name))
      .filter((dir) => existsSync(dir));
  }

  /** The bot's own plugin folder (state.json, marketplaces/, plugins/). */
  folder(botId: string): string {
    return this.root(botId);
  }

  /** The stored state, for the bot package (server/bot-zip.ts). */
  stateFor(botId: string): PluginState {
    return structuredClone(this.read(botId));
  }

  /** Restore a bot package's state on a new bot whose plugin files are
   * already in place. A plugin whose folder is missing is dropped; a
   * marketplace keeps its record (Update fetches it again). */
  restoreState(botId: string, value: unknown): { marketplaces: string[]; plugins: string[] } {
    const parsed = stateSchema.safeParse(value);
    if (!parsed.success) return { marketplaces: [], plugins: [] };
    const state: PluginState = { version: 1, marketplaces: {}, plugins: {} };
    for (const [name, record] of Object.entries(parsed.data.marketplaces).slice(0, MAX_MARKETPLACES)) {
      if (NAME.test(name)) state.marketplaces[name] = record;
    }
    for (const [key, record] of Object.entries(parsed.data.plugins).slice(0, MAX_PLUGINS)) {
      if (!NAME.test(record.name) || !NAME.test(record.marketplace) || key !== `${record.name}@${record.marketplace}`) continue;
      if (!state.marketplaces[record.marketplace] || !existsSync(this.pluginDir(botId, record.marketplace, record.name))) continue;
      state.plugins[key] = record;
    }
    this.write(botId, state);
    return { marketplaces: Object.keys(state.marketplaces).sort(), plugins: Object.keys(state.plugins).sort() };
  }

  /** Save, replace or (with null) remove the token of a marketplace. */
  setMarketplaceToken(botId: string, name: string, token: string | null, actor: string | undefined): MarketplaceListing {
    const record = this.read(botId).marketplaces[name];
    if (!record) throw new BotPluginError("No marketplace with that name on this bot.", "not_found", 404);
    if (!this.options.tokens) throw new BotPluginError("This server cannot keep marketplace tokens.", "tokens_unavailable", 503);
    if (token === null) this.options.tokens.remove(botId, record.source);
    else this.options.tokens.set(botId, record.source, token, actor);
    return this.listMarketplaces(botId).find((listing) => listing.name === name)!;
  }

  /** Forget everything of a deleted bot. */
  forgetBot(botId: string): void {
    if (!BOT_ID.test(botId)) return;
    try { this.options.tokens?.forgetBot(botId); } catch { /* the folder still goes */ }
    rmSync(this.root(botId), { recursive: true, force: true });
  }
}
