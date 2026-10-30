// Pulsatrix Flow for every member of the organization (decisions of
// 2026-10-18 and 2026-10-19: « le plugin pulsatrix-flow est installé de base
// dès que tu ajoutes un profil Perspicax, ou même dès que tu es dans
// l'organisation » ; the marketplace is served by Perspicax, private and
// behind the person's identity, never public).
//
// Perspicax declares it in the directory (`flow_plugins`, its
// flow_marketplace.rs): the private marketplace's manifest URL, the audience
// of its token, the active signed pack and its plugins (the product
// `pulsatrix-flow` and the organization's `pulsatrix-flow-<tenant>`, with
// their versions). The admin turns it off in Perspicax (`enabled` false, one
// switch on its Flow page): the copy here is taken out.
//
// The Flow guard stays on (2026-10-26). The copy loaded here has no
// hooks (like every plugin "For this bot"), so the plugin's own PreToolUse
// guard does not run in the engine. Perspicax runs that same hook on its side
// for every call of a Flow-linked profile (its server guard, `enforce`), and
// declares the marketplace only while that holds for every profile that can
// write (`guard: "enforce"`). Sagax installs and loads the copy only under
// that declaration: without `guard: "enforce"` (an older Perspicax, the
// guard off or in shadow, a write profile not linked to Flow) the copy is
// taken out and no turn loads it.
//
// How it is installed: Claude Code's own marketplace machinery, in a Claude
// Code folder of this server's own (`<data>/org-flow-plugins/claude`, used as
// CLAUDE_CONFIG_DIR for the plugin commands only, never a sign-in):
//   - settings.json declares the marketplace by URL with a `headersHelper`,
//     a small script that prints `Authorization: Bearer <token>` from the
//     environment of the command it runs under. The token is a member's
//     marketplace token (a short RFC 8693 exchange of their live sign-in,
//     at most 15 minutes), passed in the environment of the one `claude
//     plugin` process: it is never written to disk.
//   - A headless session start registers the declared marketplace (the CLI
//     reconciles `extraKnownMarketplaces`; `plugin marketplace add` refuses
//     a declared entry with a helper), then `claude plugin install` or
//     `update` (`-y`: the helper is ours) fetches each archive; Claude Code
//     checks each archive against the SHA-256 the manifest lists.
//   - Each installed plugin is copied, sanitized like a plugin "For this
//     bot" (no hooks, MCP, LSP or bin on the host), to `load/<name>`, and
//     that copy loads with `--plugin-dir` on the Claude turns of a bot whose
//     owner is an active member (after the bot's own plugins, never twice).
//
// Triggers: the directory (a declaration changed: a new pack, the switch), a
// person's sign-in (their own token), a Perspicax profile added, the start of
// the server and a check every 30 minutes (installs what is missing or older;
// silent when the copy matches the declaration: no command, no token).
//
// Engines: Claude Code only. Codex, Grok and the others have no Claude Code
// plugin system; they reach Flow through the Perspicax profiles of the turn
// (`flow`, `flow_action`, served by Perspicax from the same signed pack).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { copySanitizedPlugin } from "./bot-plugins.ts";
import { killCliTree, spawnCli } from "./procs.ts";
import type { FlowPluginsDeclaration } from "./perspicax-link.ts";

/** The environment variable the headers helper reads; set only on the
 * `claude plugin` processes this module runs. */
export const TOKEN_ENV = "SAGAX_FLOW_MARKETPLACE_TOKEN";

export type OrgFlowPluginState = "installed" | "pending" | "failed";

export interface OrgFlowPluginStatus {
  /** `<plugin>@<marketplace>`. */
  id: string;
  tenant: boolean;
  state: OrgFlowPluginState;
  version?: string;
  /** A short reason, never a token. */
  error?: string;
}

export interface OrgFlowPluginsStatus {
  /** unknown: Perspicax sent no declaration (an older Perspicax, or before
   * the first directory); off: the admin turned it off (or no pack). */
  mode: "unknown" | "off" | "on";
  plugins: OrgFlowPluginStatus[];
  /** Why nothing could be installed now, readable (never a token). */
  error?: string;
  /** off only: Perspicax's reason code when it holds the install back
   * (`flow_guard_not_enforced`, `flow_guard_uncovered`, ...). */
  reason?: string;
  syncedAt?: number;
}

/** What one `claude` run gave back. */
export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CliRun {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Written to stdin; stdin stays open until `done` holds or the run ends. */
  input?: string;
  /** Checked every 250 ms while the process runs: true stops it. */
  done?: () => boolean;
}

export type CliRunner = (cli: string, args: string[], run: CliRun) => Promise<CliResult>;

/** Spawn the CLI with its own process group; killed at `timeoutMs`. */
export const runCli: CliRunner = (cli, args, run) => new Promise((resolve) => {
  let stdout = "";
  let stderr = "";
  let settled = false;
  let child: ReturnType<typeof spawnCli>;
  try {
    child = spawnCli(cli, args, { env: run.env, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    resolve({ code: null, stdout: "", stderr: error instanceof Error ? error.message : String(error) });
    return;
  }
  const finish = (code: number | null) => {
    if (settled) return;
    settled = true;
    clearInterval(poll);
    clearTimeout(timer);
    resolve({ code, stdout: stdout.slice(-200_000), stderr: stderr.slice(-20_000) });
  };
  const stop = () => {
    try { child.stdin.end(); } catch { /* gone */ }
    void killCliTree(child).catch(() => false);
  };
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdin.on("error", () => {});
  child.on("error", (error) => { stderr += error.message; finish(null); });
  child.on("close", (code) => finish(code));
  const poll = setInterval(() => {
    if (run.done?.()) { stop(); }
  }, 250);
  const timer = setTimeout(() => { stderr += "\ntimed out"; stop(); }, run.timeoutMs);
  if (run.input !== undefined) child.stdin.write(run.input);
  if (!run.done) child.stdin.end();
});

const savedSchema = z.object({
  version: z.literal(2),
  /** digest of the declaration last applied in full */
  applied: z.string().optional(),
  /** plugin name -> the version its load copy holds */
  loaded: z.record(z.string(), z.string()).default({}),
}).strict();
type Saved = z.infer<typeof savedSchema>;

export interface OrgFlowPluginsOptions {
  dataDir: string;
  /** Perspicax's issuer: the marketplace must be served from its origin. */
  issuer: string;
  /** The last directory's declaration; undefined when it sent none. */
  declaration: () => FlowPluginsDeclaration | undefined;
  /** The Claude Code CLI of this server; undefined: no Claude Code engine. */
  cli: () => string | undefined;
  /** A member's marketplace token, `preferred` first (the person who just
   * signed in); undefined when no active member has a live sign-in. */
  token: (preferred?: string) => Promise<string | undefined>;
  /** Whether this principal is an active member of the organization now. */
  isMember: (principalId: string) => boolean;
  run?: CliRunner;
  /** The interpreter of the headers helper (`process.execPath`). */
  node?: string;
  /** Variables added to the environment of the `claude` commands (a test's
   * fake CLI log); the rest of the server's environment never reaches them. */
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (line: string) => void;
}

function digest(declaration: FlowPluginsDeclaration): string {
  const { enabled, guard, name, url, resource, pack, plugins } = declaration;
  return createHash("sha256").update(JSON.stringify({ enabled, guard, name, url, resource, pack, plugins })).digest("hex").slice(0, 32);
}

/** Whether Perspicax declares Flow on with its server guard enforcing every
 * write a member can make (the copy loaded here carries no hooks). */
export function guarded(declaration: FlowPluginsDeclaration | undefined): boolean {
  return Boolean(declaration && declaration.enabled && declaration.guard === "enforce" && declaration.plugins.length > 0);
}

function short(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** The last JSON line of a `--json` run. */
function lastJson(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch { /* not JSON */ }
  }
  return undefined;
}

/** A command's failure, readable, without the token (it is never printed,
 * but a message is cut and its whitespace folded all the same). */
function failure(what: string, result: CliResult, token?: string): string {
  const json = lastJson(result.stdout);
  const message = typeof json?.message === "string" ? json.message : result.stderr || result.stdout || `exit ${result.code}`;
  const text = token ? message.split(token).join("[token]") : message;
  return short(`${what}: ${text}`);
}

const HELPER = `// Sagax: the headers of the Perspicax Flow marketplace (server/org-flow-plugins.ts).
// The token comes from the environment of the one command that runs this;
// it is never written to disk.
const token = process.env.${TOKEN_ENV} || "";
if (!token) {
  process.stderr.write("no Perspicax marketplace token in this environment\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ Authorization: "Bearer " + token }));
`;

const ENV_KEEP = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "ComSpec", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"];

export class OrgFlowPlugins {
  private readonly options: OrgFlowPluginsOptions;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly run: CliRunner;
  private lock: Promise<unknown> = Promise.resolve();
  private current: OrgFlowPluginsStatus = { mode: "unknown", plugins: [] };

  constructor(options: OrgFlowPluginsOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
    this.run = options.run ?? runCli;
  }

  /** `<data>/org-flow-plugins`. */
  get root(): string {
    return join(this.options.dataDir, "org-flow-plugins");
  }

  /** The Claude Code folder of the plugin commands (CLAUDE_CONFIG_DIR). */
  get configDir(): string {
    return join(this.root, "claude");
  }

  private get stateFile(): string {
    return join(this.root, "state.json");
  }

  private loadDir(name: string): string {
    return join(this.root, "load", name);
  }

  private read(): Saved {
    try {
      return savedSchema.parse(JSON.parse(readFileSync(this.stateFile, "utf8")));
    } catch {
      return { version: 2, loaded: {} };
    }
  }

  private write(saved: Saved): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(this.stateFile, JSON.stringify(savedSchema.parse(saved), null, 2));
  }

  status(): OrgFlowPluginsStatus {
    return structuredClone(this.current);
  }

  /** Bring the copy in line with the declaration. Idempotent and
   * serialized; `principalId` is the person whose token to use first. */
  sync(reason: string, options: { principalId?: string } = {}): Promise<OrgFlowPluginsStatus> {
    const next = this.lock.catch(() => undefined).then(() => this.apply(reason, options.principalId));
    this.lock = next.catch(() => undefined);
    return next;
  }

  /** The marketplace must be Perspicax's own, its token for this audience. */
  private refusal(declaration: FlowPluginsDeclaration): string | undefined {
    let issuer: URL;
    let url: URL;
    try {
      issuer = new URL(this.options.issuer);
      url = new URL(declaration.url);
    } catch {
      return "the declared marketplace URL is not valid";
    }
    if (url.origin !== issuer.origin) return `the declared marketplace is not served by Perspicax (${url.origin})`;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && issuer.protocol === "http:")) return "the declared marketplace is not https";
    if (declaration.resource !== `${issuer.origin}${issuer.pathname.replace(/\/+$/, "")}/flow/marketplace`) return "the declared token audience is not the Flow marketplace's";
    return undefined;
  }

  private takeOut(why: string): void {
    if (existsSync(this.root)) {
      rmSync(this.root, { recursive: true, force: true });
      this.log(`[org-flow-plugins] Pulsatrix Flow taken out (${why})`);
    }
  }

  private async apply(reason: string, preferred: string | undefined): Promise<OrgFlowPluginsStatus> {
    const declaration = this.options.declaration();
    const now = this.now();
    if (!declaration) {
      // An older Perspicax, or no directory yet: leave what is there.
      this.current = { mode: "unknown", plugins: [], syncedAt: now };
      return this.status();
    }
    if (!guarded(declaration)) {
      const why = !declaration.enabled
        ? (declaration.reason ? `held back by Perspicax (${declaration.reason})` : "turned off in Perspicax")
        : declaration.guard !== "enforce"
          ? "Perspicax does not enforce the Flow guard"
          : "no Flow pack is active in Perspicax";
      this.takeOut(why);
      this.current = { mode: "off", plugins: [], syncedAt: now, ...(declaration.reason ? { reason: declaration.reason } : {}) };
      return this.status();
    }
    const market = declaration.name;
    const ids = declaration.plugins.map((plugin) => ({ ...plugin, id: `${plugin.name}@${market}` }));
    const pending = (error: string): OrgFlowPluginsStatus => {
      const saved = this.read();
      this.current = {
        mode: "on",
        error,
        syncedAt: now,
        plugins: ids.map((p) => {
          const have = saved.loaded[p.name];
          return have && existsSync(this.loadDir(p.name))
            ? { id: p.id, tenant: p.tenant, state: "installed" as const, version: have }
            : { id: p.id, tenant: p.tenant, state: "pending" as const };
        }),
      };
      return this.status();
    };
    const refused = this.refusal(declaration);
    if (refused) {
      this.log(`[org-flow-plugins] refused: ${refused}`);
      return pending(refused);
    }
    const saved = this.read();
    const wanted = digest(declaration);
    const current = ids.every((p) => saved.loaded[p.name] === p.version && existsSync(join(this.loadDir(p.name), ".claude-plugin", "plugin.json")));
    if (saved.applied === wanted && current) {
      // Already up to date: nothing to run, nothing to say.
      this.current = { mode: "on", syncedAt: now, plugins: ids.map((p) => ({ id: p.id, tenant: p.tenant, state: "installed", version: p.version })) };
      return this.status();
    }
    const cli = this.options.cli();
    if (!cli) return pending("no Claude Code engine on this server: Pulsatrix Flow installs when one is configured");
    const token = await this.options.token(preferred);
    if (!token) return pending("no member is signed in right now: Pulsatrix Flow installs at the next sign-in");

    mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    const helper = join(this.root, "headers-helper.cjs");
    writeFileAtomic(helper, HELPER);
    const node = this.options.node ?? process.execPath;
    const headersHelper = `"${node}" "${helper}"`;
    // The declaration only: the marketplace by URL with our helper, the
    // plugins enabled. No secret is written here.
    writeFileAtomic(join(this.configDir, "settings.json"), JSON.stringify({
      extraKnownMarketplaces: { [market]: { source: { source: "url", url: declaration.url, headersHelper } } },
      enabledPlugins: Object.fromEntries(ids.map((p) => [p.id, true])),
    }, null, 2));
    const env: NodeJS.ProcessEnv = {};
    for (const key of ENV_KEEP) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, this.options.env ?? {});
    env.CLAUDE_CONFIG_DIR = this.configDir;
    env[TOKEN_ENV] = token;
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    const claude = (args: string[], extra: Partial<CliRun> = {}) => this.run(cli, args, { env, timeoutMs: 120_000, ...extra });

    const known = () => {
      try {
        const listed = JSON.parse(readFileSync(join(this.configDir, "plugins", "known_marketplaces.json"), "utf8")) as Record<string, { source?: { url?: unknown } }>;
        return listed[market]?.source?.url === declaration.url;
      } catch {
        return false;
      }
    };
    const statuses: OrgFlowPluginStatus[] = [];
    let complete = true;
    try {
      if (!known()) {
        // A headless session start registers the declared marketplace.
        const started = await claude(["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"], {
          input: `${JSON.stringify({ type: "control_request", request_id: "sagax-flow", request: { subtype: "initialize" } })}\n`,
          done: known,
          timeoutMs: 90_000,
        });
        if (!known()) return pending(failure("the Perspicax marketplace could not be added", started, token));
        this.log(`[org-flow-plugins] marketplace ${market} added (${reason})`);
      } else {
        const updated = await claude(["plugin", "marketplace", "update", market, "--json"]);
        if (updated.code !== 0) return pending(failure("the Perspicax marketplace could not be read", updated, token));
      }
      const listed = await claude(["plugin", "list", "--json"]);
      let installed: Array<{ id?: unknown; version?: unknown; installPath?: unknown }> = [];
      try {
        const value = JSON.parse(listed.stdout) as unknown;
        if (Array.isArray(value)) installed = value as typeof installed;
      } catch { /* none */ }
      const have = (id: string) => installed.find((entry) => entry.id === id);
      for (const plugin of ids) {
        const before = have(plugin.id);
        if (!before || before.version !== plugin.version) {
          const result = await claude(["plugin", before ? "update" : "install", plugin.id, "-y", "--json"]);
          if (result.code !== 0) {
            complete = false;
            statuses.push({ id: plugin.id, tenant: plugin.tenant, state: "failed", error: failure(before ? "update" : "install", result, token) });
            continue;
          }
        }
        statuses.push({ id: plugin.id, tenant: plugin.tenant, state: "pending" });
      }
      // Where each one is now, then the sanitized copies that load.
      const after = await claude(["plugin", "list", "--json"]);
      try {
        const value = JSON.parse(after.stdout) as unknown;
        installed = Array.isArray(value) ? value as typeof installed : [];
      } catch {
        installed = [];
      }
      const next = this.read();
      for (const status of statuses) {
        if (status.state === "failed") continue;
        const plugin = ids.find((p) => p.id === status.id)!;
        const entry = have(plugin.id);
        const path = typeof entry?.installPath === "string" ? entry.installPath : undefined;
        if (!path || entry?.version !== plugin.version || !existsSync(path)) {
          complete = false;
          Object.assign(status, { state: "failed", error: `install: Claude Code has ${String(entry?.version ?? "nothing")} where ${plugin.version} is declared` });
          continue;
        }
        if (next.loaded[plugin.name] !== plugin.version || !existsSync(this.loadDir(plugin.name))) {
          const staging = `${this.loadDir(plugin.name)}.${process.pid}.tmp`;
          copySanitizedPlugin(path, staging);
          rmSync(this.loadDir(plugin.name), { recursive: true, force: true });
          renameSync(staging, this.loadDir(plugin.name));
          next.loaded[plugin.name] = plugin.version;
          this.log(`[org-flow-plugins] ${plugin.id} ${plugin.version} ready (${reason})`);
        }
        Object.assign(status, { state: "installed", version: plugin.version });
      }
      // A plugin no longer declared: out of Claude Code and of the load list.
      for (const entry of installed) {
        const id = typeof entry.id === "string" ? entry.id : "";
        if (id.endsWith(`@${market}`) && !ids.some((p) => p.id === id)) {
          await claude(["plugin", "uninstall", id, "--json"]);
        }
      }
      for (const name of Object.keys(next.loaded)) {
        if (!ids.some((p) => p.name === name)) {
          rmSync(this.loadDir(name), { recursive: true, force: true });
          delete next.loaded[name];
        }
      }
      this.write({ ...next, ...(complete ? { applied: wanted } : {}) });
    } catch (error) {
      return pending(short(`install: ${error instanceof Error ? error.message : String(error)}`.split(token).join("[token]")));
    }
    const failed = statuses.find((s) => s.state === "failed");
    this.current = { mode: "on", plugins: statuses, syncedAt: now, ...(failed ? { error: failed.error } : {}) };
    if (failed) this.log(`[org-flow-plugins] ${failed.id}: ${failed.error}`);
    return this.status();
  }

  /** The installed copy of one declared plugin (the folder dirsFor hands a
   * turn), or undefined: the capabilities list reads it. */
  loadedDir(name: string): string | undefined {
    if (!this.read().loaded[name]) return undefined;
    const dir = this.loadDir(name);
    return existsSync(join(dir, ".claude-plugin", "plugin.json")) ? dir : undefined;
  }

  /** The organization's plugin folders for a Claude turn of a bot owned by
   * `owner`, after the bot's own (`own`, loaded first): none for a person
   * who is not an active member, none when it is off or Perspicax does not
   * enforce the Flow guard, and none whose plugin the bot already has. */
  dirsFor(owner: string | undefined, own: readonly string[]): string[] {
    if (!owner || !this.options.isMember(owner)) return [];
    const declaration = this.options.declaration();
    if (!declaration || !guarded(declaration)) return [];
    const ownNames = new Set(own.map((dir) => basename(dir)));
    const saved = this.read();
    const dirs: string[] = [];
    for (const plugin of declaration.plugins) {
      if (ownNames.has(plugin.name) || !saved.loaded[plugin.name]) continue;
      const dir = this.loadDir(plugin.name);
      if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) dirs.push(dir);
    }
    return dirs;
  }
}
