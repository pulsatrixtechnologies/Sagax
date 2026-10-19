import { parseStoredConfig } from "./config.ts";
import { WORKSPACE_BACKUP_RECONNECT, type WorkspaceBackupReconnect, type WorkspaceBackupReconnectCategory } from "../shared/workspace-backup.ts";

// Connection sections deliberately stay on the destination as a whole: a
// restored URL must never redirect an API key retained from that device.
// Allowlisting ordinary settings also keeps future/unknown auth fields out.
const PORTABLE_CONFIG_KEYS = [
  "profile", "language", "budgets", "billing", "rooms", "threads",
  "localVm", "features", "browserProfiles",
] as const;

export function portableWorkspaceConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace configuration in backup.");
  const config = parseStoredConfig(value as Parameters<typeof parseStoredConfig>[0]);
  return Object.fromEntries(PORTABLE_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
}

// Switches that belong to the machine even inside a portable section.
// Computer sharing (lending a computer to this server) opens routes and a
// desktop connector here, so a restored workspace never turns it on or off.
const DESTINATION_FEATURES = ["sharedComputers"] as const;

export function restoredWorkspaceConfig(portable: unknown, destination: unknown): Record<string, unknown> {
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) throw new Error("Invalid destination workspace configuration; connections were not changed.");
  const merged = { ...destination } as Record<string, unknown>;
  for (const key of PORTABLE_CONFIG_KEYS) delete merged[key];
  const restored = { ...merged, ...portableWorkspaceConfig(portable) };
  const own = (destination as { features?: Record<string, unknown> }).features ?? {};
  const features: Record<string, unknown> = { ...(restored.features as Record<string, unknown> | undefined) };
  for (const key of DESTINATION_FEATURES) {
    delete features[key];
    if (own[key] !== undefined) features[key] = own[key];
  }
  if (Object.keys(features).length) restored.features = features;
  else delete restored.features;
  return restored;
}

/** Exact app-owned authentication paths, not a scan of user document text. */
export function excludedWorkspaceAuthPath(path: string): boolean {
  // Machine/provider-specific execution grants are not portable template data.
  if (/^command-allowlist\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // MCP sign-in tokens belong to this machine's browser sign-ins.
  if (/^mcp-oauth\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Sagax keeps them encrypted in mcp-oauth.enc, under the key in
  // mcp-oauth.key on a headless server (server/mcp-oauth.ts).
  if (/^mcp-oauth\.(?:enc|key)(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Organization GitHub access tokens (server/org-github-tokens.ts).
  if (/^org-github-tokens\.enc(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // File-backed provider keys (server/engine-api-keys.ts), solo and per person.
  if (/^engine-api-keys\.(?:enc|json)(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  if (/^principals\/[^/]+\/engine-api-keys\.enc(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Hermes reads `.env` itself. A verification server's home is the data
  // directory, and a turn's private home lives under engine-policies.
  if (/(?:^|\/)\.hermes\/\.env$/.test(path)) return true;
  if (/^engine-policies\/hermes-(?:solo|org)\/\.env$/.test(path)) return true;
  return /^(?:(?:providers|caddy|chrome-profile|\.agent-browser)(?:\/|$)|workspace-credentials\.json$|external-runtimes\.json$|browser-engine-key$)/.test(path) ||
    /^(?:config\.json|webhooks\.json|workspace-credentials\.json|external-runtimes\.json|browser-engine-key|sessions\.json|tunnel-account\.json|idp-grants\.enc|idp-grants\.key)\.\d+(?:\.[0-9a-f-]+)?\.tmp$/.test(path) ||
    /^(?:vm-home|vm-homes\/[^/]+)\/\.browser-profiles(?:\/|$)/.test(path);
}

/** The Organization library files Electron main downloads and verifies
 * (docs/desktop-library.md): the catalog, a catalog write in progress, and the
 * cached release files. Main fetches them again from Admin, and sign-out
 * deletes them, so a backup never keeps an Organization's package bytes. The
 * runtime's own `org-library/state.json` and `presets.json` are backed up. Like
 * the hook tokens below, an archive that holds them still restores. */
export function redownloadedOrgLibraryPath(path: string): boolean {
  return /^org-library\/(?:catalog\.json(?:\.[0-9a-f-]{36}\.tmp)?$|blobs(?:\/|$))/.test(path);
}

/** Per-turn engine hook bearers (`hook-tokens/<digest>.token`, written by the
 * Claude driver). They are dead once their turn settles, so they are never
 * exported. Unlike the saved auth paths above they are not refused on import:
 * v0.1.85 did export them, and such a backup must still restore, without them.
 * The same holds for the session registry's open marker: it describes the
 * process that wrote it, so it is never exported or installed, and a restore
 * leaves the destination's own marker where it is (workspace-backup.ts). */
export function ephemeralWorkspaceTokenPath(path: string): boolean {
  // The server log window (server/server-log-ring.ts) belongs to the machine
  // and the process that wrote it, like the marker.
  // The internal bearers handed to a turn (`comms-tokens/<digest>.token`,
  // server/drivers/spawn-contract.ts) die with it like the hook tokens.
  return /^(?:hook-tokens(?:\/|$)|comms-tokens(?:\/|$)|server-log(?:\/|$)|sessions\.json\.open$)/.test(path);
}

/** A bot's DuckDB database (`bots/<id>/data.duckdb`, its WAL, its spill
 * directory; server/data/engine.ts), and the same for each derived Data
 * scope (`data-scopes/<id>/<scope>/`, server/data/scope.ts) plus the
 * transient folder a confined https load downloads into. Copying the file
 * while the engine holds it open is not a consistent snapshot (an unflushed
 * WAL), it can run to gigabytes, and every table in it came from a source
 * the bot can load again. The sheet beside it (sheet.json) is backed up,
 * except a confidential thread's (confidentialDataScopePath below). */
export function liveDataEnginePath(path: string): boolean {
  return /^(?:bots\/[^/]+|data-scopes\/[^/]+\/[^/]+)\/(?:data\.duckdb(?:\.wal)?$|data-tmp(?:\/|$)|data-downloads(?:\/|$))/.test(path);
}

/** A confidential thread's own Data scope (`data-scopes/<botId>/t-<hash>/`,
 * server/data/scope.ts): its sheet, its database, its downloads and anything
 * else that lands in that folder. A confidential thread leaves no trace in a
 * workspace backup (docs/confidential-threads.md), and only a confidential
 * thread ever gets a thread scope, so the whole folder is left out whether
 * or not the roster still names the thread (a deleted thread not yet wiped,
 * a thread made confidential later). The match ignores case, so a
 * differently cased archive path cannot slip through on a case-insensitive
 * disk. Like the hook tokens above, an archive from a release that did
 * export it still restores, without it: the folder is never installed, so a
 * restored thread id never hands its sheet to another person. */
export function confidentialDataScopePath(path: string): boolean {
  return /^data-scopes\/[^/]+\/t-[^/]*(?:\/|$)/i.test(path);
}

/** The engine homes inside the data folder (server/engine-transcripts.ts
 * dataEngineHomes): a person's engine folders (`principals/<id>/<engine>`,
 * `principals/<id>/<driver>-key`), the organization's key homes
 * (`org/<driver>-key`) and the homes Sagax owns for withheld turns
 * (`engine-policies/<name>`). `providers/` never leaves at all. */
const ENGINE_HOME = /^(?:principals\/[^/]+\/[^/]+|org\/[^/]+|engine-policies\/[^/]+)\/(.+)$/i;

/** File names an engine CLI keeps a sign-in in, anywhere in its home (the
 * CLI's own folder may sit under a HOME Sagax set: `grok/.grok/auth.json`):
 * - `.credentials.json`: Claude Code's OAuth tokens and MCP sign-ins off
 *   macOS's keychain; Codex's MCP sign-ins (file store).
 * - `auth.json`: Codex (ChatGPT tokens or API key), Grok Build, pi, OpenCode,
 *   Hermes (a link to the source home's), Droid, Cursor Agent off macOS.
 * - `mcp_credentials.json` (Grok), `mcp-auth.json` and `account.json`
 *   (OpenCode), `oauth_creds.json`, `google_accounts.json` and
 *   `mcp-oauth-tokens*.json` (Gemini, Qwen), `secrets.json` (Cline),
 *   `auth.encrypted` (Droid).
 * - `.env`: Hermes, Gemini and Qwen read provider keys from it.
 * - `.pulsabot-login.json`: Sagax's own « signed in » marker
 *   (server/principal-engine-logins.ts). It goes with the sign-in it vouches
 *   for, so a restored person shows « Sign in » rather than a dead login.
 * - `.claude.json.backup*`: Claude Code's copies of `.claude.json`, which
 *   hold the account and any API key (`.claude.json` itself is copied
 *   without them: withoutEngineAuthFields).
 * Each also with the suffix an atomic write or a lock leaves beside it. */
const ENGINE_CREDENTIAL_FILE = /^(?:\.credentials\.json|auth\.json|auth\.encrypted|mcp_credentials\.json|mcp-auth\.json|account\.json|oauth_creds\.json|google_accounts\.json|mcp-oauth-tokens(?:-v\d+)?\.json|secrets\.json|\.env|\.pulsabot-login\.json)(?:\.lock|\.bak|\.tmp(?:[.-][\w.-]*)?|\.\d+(?:\.[0-9a-f-]+)?\.tmp)?$|^\.claude\.json\.(?:backup|bak)(?:[.-][\w.-]*)?$/i;

/** Folders that are a sign-in as a whole: Kimi Code's `credentials/`
 * (`credentials/kimi-code.json`), a desktop keyring a CLI may fall back to
 * (`.local/share/keyrings`, `python_keyring`). */
const ENGINE_CREDENTIAL_FOLDER = /^(?:credentials|keyrings|python_keyring)$/i;

/** An engine's saved sign-in in an engine home of the data folder (JC,
 * 2026-10-18: « Exclure les jetons »). A workspace backup keeps each
 * engine's settings, skills and sessions, never its tokens or keys: after a
 * restore each person signs in to their engines again. Like the hook tokens
 * above, an archive from a release that did export them still restores,
 * without them (a restore never installs them). The match ignores case, so
 * a differently cased archive path cannot slip through on a
 * case-insensitive disk. */
export function engineCredentialPath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  if (!rest) return false;
  const parts = rest.split("/");
  if (parts.slice(0, -1).some((part) => ENGINE_CREDENTIAL_FOLDER.test(part))) return true;
  const name = parts[parts.length - 1]!;
  return ENGINE_CREDENTIAL_FILE.test(name) || ENGINE_CREDENTIAL_FOLDER.test(name);
}

/** An engine's settings file in an engine home, by name: Claude Code's
 * `.claude.json`, `settings.json` and `settings.local.json`, Codex, Grok and
 * Kimi `config.toml`, Hermes `config.yaml`, pi `models.json`, OpenCode
 * `opencode.json`, Droid and Qwen `settings.json`, the MCP files (`mcp.json`,
 * `.mcp.json`, `mcp_config.json`, Cline's `cline_mcp_settings.json`). They
 * are copied, without their secrets (withoutEngineSecrets). */
const ENGINE_SETTINGS_FILE = /^(?:\.claude\.json|settings(?:\.local)?\.json|config\.(?:json|toml|ya?ml)|models\.json|opencode\.jsonc?|\.?mcp\.json|mcp_config\.json|cline_mcp_settings\.json)$/i;

export function engineSettingsPath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  return !!rest && ENGINE_SETTINGS_FILE.test(rest.split("/").pop()!);
}

/** A field that holds a secret by its name alone: an API key, a token, a
 * client secret, a password, an authorization header, Claude Code's account
 * and key approvals. Names that point at a secret elsewhere
 * (`api_key_env`, `bearer_token_env_var`, `envKey`) do not match. */
const SECRET_FIELD = /^(?:api[_-]?key|x-api-key|primary[_-]?api[_-]?key|custom[_-]?api[_-]?key(?:[_-]?responses)?|(?:access|refresh|id|bearer|auth|session|oauth|experimental[_-]bearer)[_-]?token|tokens?|secrets?|client[_-]?secret|passw(?:or)?d|authorization|bearer|private[_-]?key|oauth[_-]?account|cookie)$/i;
/** Maps whose every value is left out: an MCP server's or an engine's
 * environment and request headers. Their names stay readable in the
 * reconnect list (the engine settings line), their values never travel. */
const SECRET_MAP = /^(?:env|environment|headers|http[_-]?headers|env[_-]?vars?)$/i;

function scrubJson(value: unknown): number {
  let removed = 0;
  if (Array.isArray(value)) {
    for (const item of value) removed += scrubJson(item);
    return removed;
  }
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (SECRET_FIELD.test(key) && item !== null && item !== "" && item !== undefined) {
      delete record[key];
      removed++;
    } else if (SECRET_MAP.test(key) && item && typeof item === "object" && !Array.isArray(item)) {
      const map = item as Record<string, unknown>;
      for (const name of Object.keys(map)) { delete map[name]; removed++; }
    } else removed += scrubJson(item);
  }
  return removed;
}

const TOML_KEY = /^\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*=\s*(.*)$/;
const TOML_TABLE = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const unquote = (key: string) => key.replace(/^["']|["']$/g, "");

/** A TOML settings file without its secret fields and without the values
 * of its env and header tables (`[mcp_servers.x.env]`,
 * `http_headers = { ... }`). Line based: a multi-line string value of a
 * removed field goes with it. */
function scrubToml(text: string): { text: string; removed: number } {
  const lines = text.split("\n");
  const out: string[] = [];
  let removed = 0;
  let secretTable = false;
  let until: string | null = null;
  for (const line of lines) {
    if (until) { if (line.includes(until)) until = null; continue; }
    const table = TOML_TABLE.exec(line);
    if (table) {
      const last = unquote(table[1]!.split(".").pop()!.trim());
      secretTable = SECRET_MAP.test(last) || SECRET_FIELD.test(last);
      out.push(line);
      continue;
    }
    const field = TOML_KEY.exec(line);
    if (field && (secretTable || SECRET_FIELD.test(unquote(field[1]!)) || SECRET_MAP.test(unquote(field[1]!)))) {
      removed++;
      const value = field[2]!.trim();
      for (const quote of ['"""', "'''"]) if (value.startsWith(quote) && !value.slice(3).includes(quote)) until = quote;
      continue;
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

const YAML_KEY = /^(\s*)(?:-\s+)?("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_.-]+)\s*:(?:\s+(.*))?$/;

/** A YAML settings file (Hermes `config.yaml`) without its secret fields
 * and without its env and header blocks, line based. */
function scrubYaml(text: string): { text: string; removed: number } {
  const out: string[] = [];
  let removed = 0;
  let skipDeeperThan: number | null = null;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (skipDeeperThan !== null) {
      if (!line.trim() || indent > skipDeeperThan) continue;
      skipDeeperThan = null;
    }
    const field = YAML_KEY.exec(line);
    if (field) {
      const key = unquote(field[2]!);
      const value = (field[3] ?? "").trim();
      if (SECRET_MAP.test(key) || (SECRET_FIELD.test(key) && (!value || /^[|>]/.test(value)))) {
        removed++;
        skipDeeperThan = field[1]!.length;
        continue;
      }
      if (SECRET_FIELD.test(key)) { removed++; continue; }
    }
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

/** An engine settings file (engineSettingsPath) without its secrets: API
 * keys, tokens, passwords, Claude Code's account and key approvals, and the
 * values of every env and header map (an MCP server's included). Null when
 * it holds none. Throws on a JSON file that does not parse: such a file is
 * left out whole. */
export function withoutEngineSecrets(path: string, text: string): string | null {
  const name = path.split("/").pop()!.toLowerCase();
  if (name.endsWith(".toml")) {
    const result = scrubToml(text);
    return result.removed ? result.text : null;
  }
  if (/\.ya?ml$/.test(name)) {
    const result = scrubYaml(text);
    return result.removed ? result.text : null;
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object") throw new Error("Not a settings object.");
  return scrubJson(value) ? JSON.stringify(value, null, 2) : null;
}

/** Claude Code's sign-in fields of `.claude.json`, which a restore puts
 * back from the destination's own copy (carryDestinationSecrets). */
export const CLAUDE_AUTH_FIELDS = ["oauthAccount", "primaryApiKey", "customApiKeyResponses"] as const;

/** Secrets Sagax keeps itself (JC, 2026-10-18 15:55: « Exclure tout »):
 * every sealed store or key of a person (`principals/<id>/*.enc`, `*.key`:
 * engine provider keys, personal connections, the credential vault, MCP
 * sign-ins, cloud agent keys), every sealed store or key at the top of the
 * data folder (`*.enc`, `*.key`: the marketplace Git tokens, revocations
 * pending, the HMAC keys of the agent API, the media proxy, published pages
 * and template links), and the phones' push registrations. Never exported,
 * never installed by a restore; an archive from a release that did export
 * them restores without them. */
const WORKSPACE_SECRET = /^(?:(?:principals\/[^/]+\/)?[^/]+\.(?:enc|key)(?:\.\d+\.[0-9a-f-]+\.tmp)?|push-devices(?:\/.*)?)$/i;

export function savedSignInPath(path: string): boolean {
  return engineCredentialPath(path) || WORKSPACE_SECRET.test(path);
}

/** A top-level name of the data folder whose secret stays on the
 * destination as it is (keptInPlace): the app regenerates a missing HMAC
 * key at start, and a phone registers again. */
export function destinationSignInFile(name: string): boolean {
  return !name.includes("/") && WORKSPACE_SECRET.test(name);
}

/** What a person reconnects after a restore, by category (never a name or
 * a value): the reconnect list of a backup summary. */
export function secretCategory(path: string): WorkspaceBackupReconnectCategory | null {
  const folded = path.toLowerCase();
  if (engineCredentialPath(path)) return "engines";
  const name = folded.split("/").pop()!;
  if (/^engine-api-keys\.(?:enc|json)(?:$|\.)|^workspace-credentials\.json$/.test(name)) return "providerKeys";
  if (/^connections\.enc(?:$|\.)/.test(name)) return "connections";
  if (/^credential-vault\.enc(?:$|\.)/.test(name)) return "credentialVault";
  if (/^mcp-oauth\.(?:enc|json)(?:$|\.)/.test(name)) return "mcp";
  if (/^(?:org-github-tokens|marketplace-tokens)\.enc(?:$|\.)/.test(name)) return "github";
  if (/^cloud-agent-credentials\.enc(?:$|\.)/.test(name)) return "cloudAgents";
  if (/^trigger-poller-credentials\.enc(?:$|\.)/.test(name)) return "triggers";
  if (/^push-devices\/[^/]+\.json$/.test(folded)) return "phones";
  return null;
}

/** Counts by category for the reconnect list: a person's files count once
 * per person, an engine sign-in once per engine home. */
export class ReconnectTally {
  private readonly items = new Map<WorkspaceBackupReconnectCategory, Set<string>>();
  private readonly people = new Map<WorkspaceBackupReconnectCategory, Set<string>>();
  private readonly extra = new Map<WorkspaceBackupReconnectCategory, number>();

  constructor(base?: WorkspaceBackupReconnect) {
    for (const [category, entry] of Object.entries(base ?? {}) as Array<[WorkspaceBackupReconnectCategory, { count: number } | undefined]>) {
      if (entry?.count) this.count(category, entry.count);
    }
  }

  /** One path left out (or scrubbed); its category from secretCategory unless given. */
  path(path: string, category: WorkspaceBackupReconnectCategory | null = secretCategory(path)): void {
    if (!category) return;
    const person = /^principals\/([^/]+)\//i.exec(path)?.[1];
    const home = /^((?:principals\/[^/]+|org|engine-policies)\/[^/]+)/i.exec(path)?.[1];
    const key = category === "engines" || category === "engineSettings" ? (home ?? path).toLowerCase() : path.toLowerCase();
    if (!this.items.has(category)) this.items.set(category, new Set());
    this.items.get(category)!.add(key);
    if (person) {
      if (!this.people.has(category)) this.people.set(category, new Set());
      this.people.get(category)!.add(person.toLowerCase());
    }
  }

  count(category: WorkspaceBackupReconnectCategory, count: number): void {
    if (count > 0) this.extra.set(category, (this.extra.get(category) ?? 0) + count);
  }

  result(): WorkspaceBackupReconnect {
    const out: WorkspaceBackupReconnect = {};
    for (const category of WORKSPACE_BACKUP_RECONNECT) {
      const count = (this.items.get(category)?.size ?? 0) + (this.extra.get(category) ?? 0);
      if (!count) continue;
      const people = this.people.get(category)?.size ?? 0;
      out[category] = people ? { count, people } : { count };
    }
    return out;
  }
}

/** Top-level config sections other than the portable ones that hold a
 * secret (a provider key, a token, a password, an MCP server's env or
 * headers): counted for the reconnect list, never copied. */
export function configSecretCounts(value: unknown): { providerKeys: number; mcp: number } {
  const counts = { providerKeys: 0, mcp: 0 };
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  const holdsSecret = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(holdsSecret);
    if (!item || typeof item !== "object") return false;
    return Object.entries(item as Record<string, unknown>).some(([key, inner]) =>
      (SECRET_FIELD.test(key) && typeof inner === "string" && inner.length > 0) ||
      (SECRET_MAP.test(key) && !!inner && typeof inner === "object" && Object.keys(inner).length > 0) ||
      (/^key$/i.test(key) && typeof inner === "string" && inner.length > 0) ||
      holdsSecret(inner));
  };
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((PORTABLE_CONFIG_KEYS as readonly string[]).includes(key)) continue;
    if (key === "mcpServers" && item && typeof item === "object") {
      counts.mcp += Object.values(item as Record<string, unknown>).filter(holdsSecret).length;
    } else if (key === "instances" && item && typeof item === "object") {
      counts.providerKeys += Object.values(item as Record<string, unknown>).filter(holdsSecret).length;
    } else if (holdsSecret(item)) counts.providerKeys++;
  }
  return counts;
}

/** An engine home's own scratch and caches, which the CLI makes again:
 * Codex `tmp/` (its `tmp/arg0/*` links to the codex binary, outside the
 * workspace, made every backup fail) and `.tmp/`, `.cache/`, and the
 * `Library/Caches/` a CLI run with HOME set there leaves on macOS. */
export function disposableEngineHomePath(path: string): boolean {
  const rest = ENGINE_HOME.exec(path)?.[1];
  return !!rest && /^(?:tmp|\.tmp|\.cache|Library\/Caches)(?:\/|$)/i.test(rest);
}
