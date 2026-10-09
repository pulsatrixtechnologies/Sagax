// Marketplaces of the whole installation (Plugins > Manage > Marketplaces).
//
// A marketplace is a Claude Code plugin marketplace: a git repository with
// `.claude-plugin/marketplace.json` ({ name, owner, plugins: [{ name, source,
// description, version }] }, source a path in the repository or
// { source: "github", repo } / { source: "git" | "url", url }), or the https
// address of such a manifest. Each plugin folder may carry
// `.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md`,
// `agents/` and `commands/`.
//
// "Add" on a plugin maps it onto what Sagax already has, for every bot:
//   - its MCP servers (`.mcp.json`, or `mcpServers` in plugin.json) become
//     MCP servers of this installation, with the marketplace as their source;
//   - its skills become skills of the library, switched off until read.
// Agents, commands and hooks are not installed here: the same plugin
// installed "For this bot" (server/bot-plugins.ts) loads whole, from this
// same list. There is one marketplace list for both scopes.
//
// Files: DATA_DIR/marketplaces/{state.json, repos/<name>/, plugins/<name>/<plugin>/}.
// The clone is shallow and uses this computer's git credentials, or the
// acting person's GitHub connection for github.com: no token is stored here.
// The organization's allowed-marketplaces policy applies in both scopes.
// A marketplace a bot still has plugins from is not removed (`inUse`).
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import {
  BotPluginError,
  insideRoot,
  marketplaceAllowed,
  parseGitSource,
  readMarketplaceManifest,
  runGit,
  type GitRunner,
  type GitSource,
  type MarketplacePolicy,
  type MarketplacePluginEntry,
} from "./bot-plugins.ts";
import { parseSkillMd } from "../shared/skill-md.ts";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_MARKETPLACES = 40;
const GIT_TIMEOUT_MS = 120_000;
const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_SKILL_BYTES = 256 * 1024;

export { BotPluginError as MarketplaceError };

const marketplaceRecord = z.object({
  source: z.string(),
  url: z.string(),
  ref: z.string().optional(),
  /** set when the marketplace is a manifest address, not a repository */
  manifestUrl: z.string().optional(),
  description: z.string().optional(),
  addedAt: z.number(),
  addedBy: z.string().optional(),
  updatedAt: z.number(),
}).strict();

const installedRecord = z.object({
  name: z.string(),
  marketplace: z.string(),
  version: z.string().optional(),
  installedAt: z.number(),
  /** MCP server names this plugin added */
  servers: z.array(z.string()),
  /** library skills this plugin added */
  skills: z.array(z.string()),
}).strict();

const stateSchema = z.object({
  version: z.literal(1),
  marketplaces: z.record(z.string(), marketplaceRecord),
  installed: z.record(z.string(), installedRecord),
}).strict();

type State = z.infer<typeof stateSchema>;
export type InstalledMarketplacePlugin = z.infer<typeof installedRecord> & { key: string };
export type SharedMarketplaceRecord = z.infer<typeof marketplaceRecord>;

export interface MarketplaceView {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  addedAt: number;
  updatedAt: number;
  /** bots with at least one plugin installed from it ("For this bot") */
  bots: number;
  plugins: Array<{
    name: string;
    description?: string;
    version?: string;
    category?: string;
    installed: boolean;
    servers: string[];
    skills: string[];
  }>;
}

// ── the install mapping (pure) ───────────────────────────────────────────

/** What "Add" on a plugin brings: MCP server entries in the stored shape
 * (still to be checked by the registry) and SKILL.md files. */
export interface PluginInstallPlan {
  servers: Array<{ name: string; entry: Record<string, unknown> }>;
  skills: Array<{ name: string; text: string }>;
  /** what was left out and why, for the person */
  skipped: string[];
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);

function readJson(file: string): Json | null {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_MANIFEST_BYTES) return null;
    return record(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** `${CLAUDE_PLUGIN_ROOT}` points at the plugin's own folder on this disk. */
function withPluginRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") return value.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
  if (Array.isArray(value)) return value.map((item) => withPluginRoot(item, root));
  const object = record(value);
  if (object) return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, withPluginRoot(item, root)]));
  return value;
}

/** The keys a stored server may carry, from a Claude Code style entry. */
function storedShape(entry: Json): Json | null {
  if (typeof entry.url === "string") {
    const type = entry.type === "sse" ? "sse" : "http";
    return { type, url: entry.url, ...(record(entry.headers) ? { headers: entry.headers } : {}) };
  }
  if (typeof entry.command === "string") {
    return {
      command: entry.command,
      ...(Array.isArray(entry.args) ? { args: entry.args.filter((arg) => typeof arg === "string") } : {}),
      ...(record(entry.env) ? { env: entry.env } : {}),
    };
  }
  return null;
}

/** Read one plugin folder into an install plan. */
export function pluginInstallPlan(root: string): PluginInstallPlan {
  const plan: PluginInstallPlan = { servers: [], skills: [], skipped: [] };
  const blocks: Json[] = [];
  const mcpJson = readJson(join(root, ".mcp.json"));
  if (mcpJson) blocks.push(record(mcpJson.mcpServers) ?? mcpJson);
  const manifest = readJson(join(root, ".claude-plugin", "plugin.json"));
  if (manifest) {
    if (record(manifest.mcpServers)) blocks.push(record(record(manifest.mcpServers)!.mcpServers) ?? record(manifest.mcpServers)!);
    else if (typeof manifest.mcpServers === "string") {
      try {
        const file = readJson(insideRoot(root, manifest.mcpServers));
        if (file) blocks.push(record(file.mcpServers) ?? file);
      } catch {
        plan.skipped.push(`mcpServers path ${manifest.mcpServers}`);
      }
    }
  }
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const [name, raw] of Object.entries(block)) {
      if (seen.has(name)) continue;
      const entry = record(raw);
      const shape = entry ? storedShape(record(withPluginRoot(entry, root))!) : null;
      if (!shape) {
        plan.skipped.push(`MCP server ${name}`);
        continue;
      }
      seen.add(name);
      plan.servers.push({ name, entry: shape });
    }
  }
  const skillsDir = join(root, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    for (const folder of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!folder.isDirectory()) continue;
      const file = join(skillsDir, folder.name, "SKILL.md");
      if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
      if (statSync(file).size > MAX_SKILL_BYTES) {
        plan.skipped.push(`skill ${folder.name} (too large)`);
        continue;
      }
      const text = readFileSync(file, "utf8");
      const parsed = parseSkillMd(text);
      if ("error" in parsed) {
        plan.skipped.push(`skill ${folder.name} (${parsed.error})`);
        continue;
      }
      plan.skills.push({ name: parsed.name, text });
    }
  }
  return plan;
}

/** The MCP server name a plugin's server is added under: its own name made
 * safe, then the plugin's name in front of it if that is taken. */
export function marketplaceServerName(server: string, plugin: string, taken: ReadonlySet<string>): string {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "");
  const base = slug(server).slice(0, 32) || "plugin";
  if (!taken.has(base)) return base;
  const prefixed = `${slug(plugin).slice(0, 12)}-${base}`.slice(0, 32).replace(/-+$/, "");
  if (prefixed && /^[a-z]/.test(prefixed) && !taken.has(prefixed)) return prefixed;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base.slice(0, 28)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36).slice(-6)}`;
}

/** Is this the address of a manifest rather than a repository? */
export function isManifestUrl(source: string): boolean {
  return /^https:\/\/\S+\.json(?:\?\S*)?$/i.test(source.trim());
}

// ── the store ────────────────────────────────────────────────────────────

export interface PluginMarketplacesOptions {
  dataDir: string;
  git?: GitRunner;
  gitEnvironment: (actor: string | undefined) => Record<string, string>;
  policy: () => MarketplacePolicy | undefined;
  /** reads a manifest address (https only) */
  fetchText?: (url: string) => Promise<string>;
  /** the bots with plugins installed from a marketplace (server/bot-plugins.ts) */
  inUse?: (name: string) => string[];
  now?: () => number;
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new BotPluginError(`The manifest address answered ${response.status}.`, "repository_unreadable", 422);
  const text = await response.text();
  if (text.length > MAX_MANIFEST_BYTES) throw new BotPluginError("The manifest is too large.", "too_large", 422);
  return text;
}

export class PluginMarketplaces {
  private readonly options: PluginMarketplacesOptions;
  private readonly git: GitRunner;
  private readonly now: () => number;
  private readonly fetchText: (url: string) => Promise<string>;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(options: PluginMarketplacesOptions) {
    this.options = options;
    this.git = options.git ?? runGit;
    this.now = options.now ?? Date.now;
    this.fetchText = options.fetchText ?? defaultFetchText;
  }

  private get root(): string {
    return join(this.options.dataDir, "marketplaces");
  }

  private repoDir(name: string): string {
    if (!NAME.test(name)) throw new BotPluginError("invalid marketplace", "invalid_source");
    return join(this.root, "repos", name);
  }

  /** The marketplace's own files (its marketplace.json and plugin folders). */
  repoPath(name: string): string {
    return this.repoDir(name);
  }

  record(name: string): SharedMarketplaceRecord | undefined {
    return this.read().marketplaces[name];
  }

  /** Where an installed plugin's files live (its stdio servers run there). */
  pluginDir(marketplace: string, plugin: string): string {
    if (!NAME.test(marketplace) || !NAME.test(plugin)) throw new BotPluginError("invalid plugin", "invalid_plugin");
    return join(this.root, "plugins", marketplace, plugin);
  }

  private read(): State {
    try {
      return stateSchema.parse(JSON.parse(readFileSync(join(this.root, "state.json"), "utf8")));
    } catch {
      return { version: 1, marketplaces: {}, installed: {} };
    }
  }

  private write(state: State): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root, "state.json"), JSON.stringify(stateSchema.parse(state), null, 2));
  }

  /** One change at a time: two Adds never clone into the same folder. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lock.catch(() => undefined).then(work);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private checkPolicy(source: GitSource): void {
    if (!marketplaceAllowed(this.options.policy(), source)) {
      throw new BotPluginError(`Your organization does not allow plugins from ${source.id}.`, "marketplace_not_allowed", 403);
    }
  }

  private async clone(source: GitSource, into: string, actor: string | undefined): Promise<void> {
    const staging = `${into}.tmp-${process.pid}-${this.now()}`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(join(staging, ".."), { recursive: true });
    try {
      await this.git(["clone", "--depth", "1", "--single-branch", "--no-tags", ...(source.ref ? ["--branch", source.ref] : []), "--", source.url, staging], {
        env: this.options.gitEnvironment(source.github ? actor : undefined), timeoutMs: GIT_TIMEOUT_MS,
      });
      rmSync(join(staging, ".git"), { recursive: true, force: true });
      rmSync(into, { recursive: true, force: true });
      renameSync(staging, into);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  list(): MarketplaceView[] {
    const state = this.read();
    return Object.entries(state.marketplaces).map(([name, market]): MarketplaceView => {
      let entries: MarketplacePluginEntry[] = [];
      try {
        entries = readMarketplaceManifest(this.repoDir(name)).plugins;
      } catch {
        entries = [];
      }
      return {
        name,
        source: market.manifestUrl ?? market.source,
        ...(market.ref ? { ref: market.ref } : {}),
        ...(market.description ? { description: market.description } : {}),
        addedAt: market.addedAt,
        updatedAt: market.updatedAt,
        bots: this.options.inUse?.(name).length ?? 0,
        plugins: entries.map((entry) => {
          const installed = state.installed[`${entry.name}@${name}`];
          return {
            name: entry.name,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.version ? { version: entry.version } : {}),
            ...(entry.category ? { category: entry.category } : {}),
            installed: Boolean(installed),
            servers: installed?.servers ?? [],
            skills: installed?.skills ?? [],
          };
        }),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  installed(): InstalledMarketplacePlugin[] {
    return Object.entries(this.read().installed).map(([key, value]) => ({ key, ...value }));
  }

  /** Add (or fetch again) a marketplace: owner/repo, an https git address,
   * or the https address of a marketplace.json. `name` keeps the name it is
   * stored under (a refresh of a marketplace renamed at migration). */
  add(input: { source: string; ref?: string }, actor: string | undefined, options: { name?: string } = {}): Promise<MarketplaceView> {
    return this.serial(async () => {
      const state = this.read();
      const staging = join(this.root, "repos", `.incoming-${this.now()}`);
      const manifestUrl = isManifestUrl(input.source) ? input.source.trim() : undefined;
      let source: GitSource;
      try {
        if (manifestUrl) {
          const url = new URL(manifestUrl);
          if (url.username || url.password) throw new BotPluginError("Put no credentials in the address.", "invalid_source");
          source = { id: manifestUrl.toLowerCase(), url: manifestUrl };
          this.checkPolicy(source);
          const text = await this.fetchText(manifestUrl);
          mkdirSync(join(staging, ".claude-plugin"), { recursive: true });
          writeFileSync(join(staging, ".claude-plugin", "marketplace.json"), text);
        } else {
          source = parseGitSource(input.source, input.ref?.trim() || undefined);
          this.checkPolicy(source);
          await this.clone(source, staging, actor);
        }
        const manifest = readMarketplaceManifest(staging);
        const sourceId = manifestUrl ?? source.id;
        const sameSource = Object.entries(state.marketplaces)
          .find(([, market]) => (market.manifestUrl ?? market.source) === sourceId && (market.ref ?? "") === (source.ref ?? ""))?.[0];
        const name = options.name ?? sameSource ?? manifest.name;
        const taken = state.marketplaces[name];
        if (taken && (taken.manifestUrl ?? taken.source) !== sourceId) {
          throw new BotPluginError(`A marketplace named ${name} is already added from ${taken.manifestUrl ?? taken.source}.`, "name_taken", 409);
        }
        if (!taken && Object.keys(state.marketplaces).length >= MAX_MARKETPLACES) {
          throw new BotPluginError(`Add at most ${MAX_MARKETPLACES} marketplaces.`, "too_many", 400);
        }
        const target = this.repoDir(name);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(join(target, ".."), { recursive: true });
        renameSync(staging, target);
        const now = this.now();
        state.marketplaces[name] = {
          source: source.id,
          url: source.url,
          ...(source.ref ? { ref: source.ref } : {}),
          ...(manifestUrl ? { manifestUrl } : {}),
          ...(manifest.description ? { description: manifest.description } : {}),
          addedAt: taken?.addedAt ?? now,
          ...((taken?.addedBy ?? actor) ? { addedBy: taken?.addedBy ?? actor } : {}),
          updatedAt: now,
        };
        this.write(state);
        return this.list().find((view) => view.name === name)!;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    });
  }

  refresh(name: string, actor: string | undefined): Promise<MarketplaceView> {
    const market = this.read().marketplaces[name];
    if (!market) return Promise.reject(new BotPluginError("No marketplace with that name.", "not_found", 404));
    return this.add({ source: market.manifestUrl ?? (market.source.includes("://") ? market.url : market.source), ...(market.ref ? { ref: market.ref } : {}) }, actor, { name });
  }

  /** Forget a marketplace. Its installed plugins must be uninstalled first,
   * for everyone and on every bot, so nothing is left without a source. */
  remove(name: string): Promise<void> {
    return this.serial(async () => {
      const state = this.read();
      if (!state.marketplaces[name]) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      const left = Object.values(state.installed).filter((plugin) => plugin.marketplace === name).map((plugin) => plugin.name);
      if (left.length) throw new BotPluginError(`Uninstall its plugins first: ${left.join(", ")}.`, "has_plugins", 409);
      const bots = this.options.inUse?.(name) ?? [];
      if (bots.length) throw new BotPluginError(`${bots.length === 1 ? "A bot still uses" : `${bots.length} bots still use`} plugins from this marketplace. Uninstall them for each bot first.`, "in_use", 409);
      delete state.marketplaces[name];
      rmSync(this.repoDir(name), { recursive: true, force: true });
      this.write(state);
    });
  }

  /** Take in a marketplace a bot had on its own before the two lists were
   * one (migration). The same source (and ref) already here is reused; a
   * name taken by another source gets a suffix. Its files are copied from
   * `from` when this list has none. Returns the name it is stored under. */
  adopt(input: { name: string; record: SharedMarketplaceRecord; from?: string }): string {
    const state = this.read();
    const sourceId = input.record.manifestUrl ?? input.record.source;
    const same = Object.entries(state.marketplaces)
      .find(([, market]) => (market.manifestUrl ?? market.source) === sourceId && (market.ref ?? "") === (input.record.ref ?? ""))?.[0];
    let name = same ?? input.name;
    for (let suffix = 2; !same && state.marketplaces[name]; suffix++) name = `${input.name.slice(0, 60)}-${suffix}`;
    if (!NAME.test(name)) throw new BotPluginError("invalid marketplace", "invalid_source");
    const target = this.repoDir(name);
    if (input.from && existsSync(join(input.from, ".claude-plugin", "marketplace.json")) && !existsSync(join(target, ".claude-plugin", "marketplace.json"))) {
      copyPlain(input.from, target);
    }
    if (!same) {
      state.marketplaces[name] = { ...input.record };
      this.write(state);
    }
    return name;
  }

  /** Put a plugin's files in place and read what it brings. The caller
   * adds the servers and skills, then records them with `recordInstall`. */
  prepare(marketplace: string, plugin: string, actor: string | undefined): Promise<{ dir: string; plan: PluginInstallPlan; version?: string }> {
    return this.serial(async () => {
      const state = this.read();
      const market = state.marketplaces[marketplace];
      if (!market) throw new BotPluginError("No marketplace with that name.", "not_found", 404);
      const repo = this.repoDir(marketplace);
      const entry = readMarketplaceManifest(repo).plugins.find((candidate) => candidate.name === plugin);
      if (!entry) throw new BotPluginError("That plugin is not in this marketplace.", "not_found", 404);
      const target = this.pluginDir(marketplace, plugin);
      if (entry.source.kind === "git") {
        this.checkPolicy(entry.source.git);
        const checkout = join(this.root, "plugins", `.checkout-${this.now()}`);
        try {
          await this.clone(entry.source.git, checkout, actor);
          copyPlain(entry.source.path ? insideRoot(checkout, entry.source.path) : checkout, target);
        } finally {
          rmSync(checkout, { recursive: true, force: true });
        }
      } else if (market.manifestUrl) {
        // A manifest address has no repository beside it: read the plugin's
        // MCP servers over https; skills need a repository (git) marketplace.
        await this.fetchPluginFiles(market.manifestUrl, entry.source.path, target);
      } else {
        copyPlain(insideRoot(repo, entry.source.path), target);
      }
      return { dir: target, plan: pluginInstallPlan(target), ...(entry.version ? { version: entry.version } : {}) };
    });
  }

  private async fetchPluginFiles(manifestUrl: string, path: string, target: string): Promise<void> {
    const base = new URL(manifestUrl.replace(/\.claude-plugin\/marketplace\.json(?:\?.*)?$/i, ""));
    const folder = new URL(path.replace(/^\.\//, "").replace(/\/?$/, "/"), base);
    if (!folder.href.startsWith(base.href)) throw new BotPluginError("The plugin's path leaves its marketplace.", "invalid_plugin", 422);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(join(target, ".claude-plugin"), { recursive: true });
    for (const file of [".mcp.json", ".claude-plugin/plugin.json"]) {
      try {
        writeFileSync(join(target, file), await this.fetchText(new URL(file, folder).href));
      } catch {
        // absent is normal: a plugin need not have either file
      }
    }
  }

  recordInstall(marketplace: string, plugin: string, result: { version?: string; servers: string[]; skills: string[] }): InstalledMarketplacePlugin {
    const state = this.read();
    const key = `${plugin}@${marketplace}`;
    const previous = state.installed[key];
    state.installed[key] = {
      name: plugin,
      marketplace,
      ...(result.version ? { version: result.version } : {}),
      installedAt: previous?.installedAt ?? this.now(),
      servers: [...new Set([...(previous?.servers ?? []), ...result.servers])],
      skills: [...new Set([...(previous?.skills ?? []), ...result.skills])],
    };
    this.write(state);
    return { key, ...state.installed[key]! };
  }

  /** Forget an installed plugin and remove its files; the caller removes
   * the servers and skills it returns. */
  recordUninstall(marketplace: string, plugin: string): InstalledMarketplacePlugin {
    const state = this.read();
    const key = `${plugin}@${marketplace}`;
    const installed = state.installed[key];
    if (!installed) throw new BotPluginError("That plugin is not installed.", "not_found", 404);
    delete state.installed[key];
    this.write(state);
    rmSync(this.pluginDir(marketplace, plugin), { recursive: true, force: true });
    return { key, ...installed };
  }
}

/** Copy a plugin folder without links or git metadata. */
function copyPlain(from: string, to: string): void {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new BotPluginError("The plugin's folder is missing from its repository.", "invalid_plugin", 422);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: false,
    filter: (path) => !lstatSync(path).isSymbolicLink() && !path.split(/[\\/]/).includes(".git"),
  });
}
