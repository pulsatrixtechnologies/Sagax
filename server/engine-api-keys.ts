// Access keys pasted on a provider card.
//
// Config-backed keys (OpenAI, Mistral, …) stay in config.json on a solo
// server, which already redacts them. On an organization server that file is
// the organization's key, so a paste there is refused: one person must not
// rewrite a key everyone falls back on.
//
// File-backed keys (Cursor, Droid, Gemini, MiniMax, Hermes) are sealed with
// the mcp-oauth vault key (AES-256-GCM, AAD `sagax engine-api-keys v1`),
// mode 0600. Solo: `<data>/engine-api-keys.enc`. Organization: one file per
// person, `principals/<id>/engine-api-keys.enc`. A request with no person is
// refused. The plaintext never goes into a log, a bot prompt, a backup or
// an answer.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { resolveVaultKey, type VaultKeySource } from "./mcp-oauth.ts";

export const ENGINE_API_KEYS_FILE = "engine-api-keys.enc";

/** Hermes provider id → the variable that provider reads. The only place
 * those names are chosen; a save never invents a variable of its own. */
export const HERMES_PROVIDER_ENV = {
  openrouter: "OPENROUTER_API_KEY",
  glm: "GLM_API_KEY",
  zai: "ZAI_API_KEY",
} as const;

export type HermesProvider = keyof typeof HERMES_PROVIDER_ENV;

const AAD = Buffer.from("sagax engine-api-keys v1");
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

const FILE_DRIVERS: Record<string, { env: string } | { hermes: true }> = {
  cursorAgent: { env: "CURSOR_API_KEY" },
  droidAgent: { env: "FACTORY_API_KEY" },
  minimax: { env: "MINIMAX_API_KEY" },
  geminiAgent: { env: "GEMINI_API_KEY" },
  hermesAgent: { hermes: true },
};

export type EngineKeyTarget =
  | { kind: "config"; section: "openai" | "openrouter" | "openaiCompat" | "anthropic" | "xai" | "mistral" | "cerebras" | "opencodeGo"; field: "key" | "apiKey" }
  | { kind: "file"; env: string }
  | { kind: "file"; hermes: true };

export type EngineKeyScope =
  | { organization: false }
  | { organization: true; principalId: string | null };

export type EngineKeySource = () => VaultKeySource;

export class EngineKeyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The variable a Hermes provider reads, or null when the name is unknown.
 * An omitted provider is OpenRouter. */
export function hermesProviderEnv(provider: string | undefined): string | null {
  const name = (provider ?? "openrouter").trim().toLowerCase();
  if (!name) return HERMES_PROVIDER_ENV.openrouter;
  if (!Object.prototype.hasOwnProperty.call(HERMES_PROVIDER_ENV, name)) return null;
  return HERMES_PROVIDER_ENV[name as HermesProvider];
}

/** Where a pasted key for this instance is stored. Null when this card
 * must not take one (a subscription CLI, or the server's own Claude login). */
export function engineKeyTarget(instanceId: string, driver: string): EngineKeyTarget | null {
  if (instanceId === "openai") return { kind: "config", section: "openai", field: "key" };
  if (instanceId === "openrouter") return { kind: "config", section: "openrouter", field: "key" };
  if (instanceId === "claudeApi") return { kind: "config", section: "anthropic", field: "key" };
  if (instanceId === "xaiApi" || driver === "grok") return { kind: "config", section: "xai", field: "key" };
  if (driver === "mistral") return { kind: "config", section: "mistral", field: "key" };
  if (driver === "cerebras") return { kind: "config", section: "cerebras", field: "key" };
  if (driver === "opencodeGo" || instanceId === "opencodeGo") return { kind: "config", section: "opencodeGo", field: "apiKey" };
  if (driver === "openai-compat") return { kind: "config", section: "openaiCompat", field: "key" };
  const file = FILE_DRIVERS[driver];
  if (!file) return null;
  if ("hermes" in file) return { kind: "file", hermes: true };
  return { kind: "file", env: file.env };
}

/** Empty clears the key. Anything else is one line, 8 to 400 characters,
 * with no whitespace or control character. The value is never included in
 * an error. Checked by code point, not a control-character regex. */
export function normalizeEngineKey(raw: string): string {
  const key = raw.trim();
  if (!key) return "";
  let rejected = key.length < 8 || key.length > 400;
  for (let i = 0; !rejected && i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 32 || code === 127) rejected = true;
  }
  if (rejected) {
    throw new EngineKeyError("Enter the access key as a single line, between 8 and 400 characters.", 400, "engine_key_shape");
  }
  return key;
}

/** Who this paste belongs to. An organization config key is the shared
 * fallback and is refused. An organization file key needs a person. */
export function engineKeyScope(organization: boolean, principalId: string | null, target: EngineKeyTarget): EngineKeyScope {
  if (organization && target.kind === "config") {
    throw new EngineKeyError("This provider's key is shared by the organization. Set it in Settings.", 403, "engine_key_shared");
  }
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  if (!PRINCIPAL.test(id)) {
    throw new EngineKeyError("A provider key on an organization server belongs to one person.", 403, "engine_key_no_person");
  }
  return { organization: true, principalId: id };
}

type Store = Record<string, Record<string, string>>;

function allowedEnv(driver: string, envName: string): boolean {
  const file = FILE_DRIVERS[driver];
  if (!file) return false;
  if ("hermes" in file) return Object.values(HERMES_PROVIDER_ENV).includes(envName as (typeof HERMES_PROVIDER_ENV)[HermesProvider]);
  return envName === file.env;
}

function storePath(dataDir: string, scope: EngineKeyScope): string {
  if (scope.organization) {
    const id = scope.principalId?.trim().toLowerCase() ?? "";
    if (!PRINCIPAL.test(id)) {
      throw new EngineKeyError("A provider key on an organization server belongs to one person.", 403, "engine_key_no_person");
    }
    return join(dataDir, "principals", id, ENGINE_API_KEYS_FILE);
  }
  return join(dataDir, ENGINE_API_KEYS_FILE);
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
    }
  } catch (error) {
    if (error instanceof EngineKeyError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
    }
  }
}

function sourceFor(dataDir: string, source?: EngineKeySource): EngineKeySource {
  return source ?? (() => resolveVaultKey(dataDir));
}

function vaultKey(source: EngineKeySource): Buffer {
  const got = source();
  if (got.kind !== "key") {
    throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
  }
  return got.key;
}

function parseStore(value: unknown): Store {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Store = {};
  for (const [driver, row] of Object.entries(value as Record<string, unknown>)) {
    if (!FILE_DRIVERS[driver] || !row || typeof row !== "object" || Array.isArray(row)) continue;
    const kept: Record<string, string> = {};
    for (const [env, key] of Object.entries(row)) {
      if (typeof key === "string" && key && allowedEnv(driver, env)) kept[env] = key;
    }
    if (Object.keys(kept).length) out[driver] = kept;
  }
  return out;
}

function openStore(raw: string, key: Buffer): Store {
  const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") {
    throw new Error("format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plain) as { version?: unknown; keys?: unknown };
  if (parsed.version !== 1) throw new Error("format");
  return parseStore(parsed.keys);
}

function sealStore(store: Store, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ version: 1, keys: store }), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

/** Read a store. `inject` returns an empty store when the file is missing
 * or cannot be opened, so a turn still starts. `strict` refuses to guess. */
function readStore(dataDir: string, scope: EngineKeyScope, source: EngineKeySource, mode: "inject" | "strict"): Store {
  if (scope.organization && !scope.principalId?.trim()) {
    if (mode === "inject") return {};
    throw new EngineKeyError("A provider key on an organization server belongs to one person.", 403, "engine_key_no_person");
  }
  let path: string;
  try {
    path = storePath(dataDir, scope);
    refuseSymlink(path);
  } catch (error) {
    if (mode === "inject") return {};
    throw error;
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    if (mode === "inject") return {};
    throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
  }
  try {
    return openStore(raw, vaultKey(source));
  } catch (error) {
    if (mode === "inject") return {};
    if (error instanceof EngineKeyError) throw error;
    throw new EngineKeyError("The access key could not be saved. Try again.", 503, "store_unavailable");
  }
}

function writeStore(dataDir: string, scope: EngineKeyScope, store: Store, source: EngineKeySource): void {
  const path = storePath(dataDir, scope);
  refuseSymlink(path);
  if (!Object.keys(store).length) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${sealStore(store, vaultKey(source))}\n`, { mode: 0o600 });
}

/** Whether this person has any file-backed key for the driver. Never the
 * key itself. An unreadable store counts as none. */
export function fileKeyConfigured(dataDir: string, scope: EngineKeyScope, driver: string, source?: EngineKeySource): boolean {
  const row = readStore(dataDir, scope, sourceFor(dataDir, source), "inject")[driver];
  return Boolean(row && Object.values(row).some((value) => value.length > 0));
}

/** Save or clear one file-backed variable. An empty key removes it. */
export function writeFileEngineKey(
  dataDir: string,
  scope: EngineKeyScope,
  driver: string,
  envName: string,
  key: string,
  source?: EngineKeySource,
): void {
  if (!allowedEnv(driver, envName)) {
    throw new EngineKeyError("This provider does not take an access key here.", 404, "engine_key_unsupported");
  }
  const resolved = sourceFor(dataDir, source);
  const store = readStore(dataDir, scope, resolved, "strict");
  const row = { ...store[driver] };
  if (key) row[envName] = key;
  else delete row[envName];
  if (Object.keys(row).length) store[driver] = row;
  else delete store[driver];
  writeStore(dataDir, scope, store, resolved);
}

/** Put a saved file key on an environment only when that variable is empty.
 * Organization with no person injects nothing, even if a solo file exists.
 * Hermes is not injected here: its turn writes a private home instead. */
export function applyStoredEngineEnv(
  environment: Record<string, string | undefined>,
  driver: string,
  dataDir: string,
  scope: EngineKeyScope,
  source?: EngineKeySource,
): void {
  if (scope.organization && !scope.principalId?.trim()) return;
  const file = FILE_DRIVERS[driver];
  if (!file || "hermes" in file || environment[file.env]) return;
  const key = readStore(dataDir, scope, sourceFor(dataDir, source), "inject")[driver]?.[file.env];
  if (key) environment[file.env] = key;
}

/** The lines a Hermes turn may put in its private `.env`. Empty when there
 * is no person on an organization server, or the store cannot be opened. */
export function hermesManagedEnvText(dataDir: string, scope: EngineKeyScope, source?: EngineKeySource): string {
  const row = readStore(dataDir, scope, sourceFor(dataDir, source), "inject").hermesAgent ?? {};
  const lines: string[] = [];
  for (const name of Object.values(HERMES_PROVIDER_ENV)) {
    const value = row[name];
    if (value) lines.push(`${name}=${value}`);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** The config.json patch for a config-backed key. Empty clears it. */
export function configKeyPatch(target: Extract<EngineKeyTarget, { kind: "config" }>, key: string): Record<string, Record<string, string>> {
  return { [target.section]: { [target.field]: key } };
}
