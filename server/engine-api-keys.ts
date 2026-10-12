// Access keys pasted on a provider card. Config-backed keys (OpenAI, Mistral,
// …) stay in config.json, which already redacts them. File-backed keys
// (Cursor, Droid, Gemini, MiniMax, Hermes) live in engine-api-keys.json,
// mode 0600, and never in a log, a bot prompt, a backup or an answer.
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { harnessHome } from "./env-path.ts";

export const ENGINE_API_KEYS_FILE = "engine-api-keys.json";

export type EngineKeyTarget =
  | { kind: "config"; section: "openai" | "openrouter" | "openaiCompat" | "anthropic" | "xai" | "mistral" | "cerebras" | "opencodeGo"; field: "key" | "apiKey" }
  | { kind: "file"; env: string; hermes?: boolean };

const FILE_KEYS: Record<string, { env: string; hermes?: boolean }> = {
  cursorAgent: { env: "CURSOR_API_KEY" },
  droidAgent: { env: "FACTORY_API_KEY" },
  minimax: { env: "MINIMAX_API_KEY" },
  geminiAgent: { env: "GEMINI_API_KEY" },
  hermesAgent: { env: "OPENROUTER_API_KEY", hermes: true },
};

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
  const file = FILE_KEYS[driver];
  if (file) return { kind: "file", env: file.env, hermes: file.hermes };
  return null;
}

/** Empty clears the key. Anything else is one line, 8 to 400 characters,
 * with no whitespace. The value is never included in an error. */
export function normalizeEngineKey(raw: string): string {
  const key = raw.trim();
  if (!key) return "";
  if (key.length < 8 || key.length > 400 || /[\s\u0000]/.test(key)) {
    const error = new Error("Enter the access key as a single line, between 8 and 400 characters.");
    (error as { status?: number }).status = 400;
    throw error;
  }
  return key;
}

type KeyFile = Record<string, Record<string, string>>;

function keyPath(dataDir: string): string {
  return join(dataDir, ENGINE_API_KEYS_FILE);
}

function refuseSymlink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Refusing to follow a link in place of the access-key file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function readKeyFile(dataDir: string): KeyFile {
  const path = keyPath(dataDir);
  refuseSymlink(path);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: KeyFile = {};
    for (const [driver, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row: Record<string, string> = {};
      for (const [env, key] of Object.entries(value)) {
        if (typeof key === "string" && key) row[env] = key;
      }
      if (Object.keys(row).length) out[driver] = row;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function atomicWrite(path: string, body: string, mode: number): void {
  refuseSymlink(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "w", mode);
  try { writeSync(fd, body); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

/** Whether a file-backed key is saved. The key itself is not returned. */
export function fileKeyConfigured(dataDir: string, driver: string, envName: string): boolean {
  return Boolean(readKeyFile(dataDir)[driver]?.[envName]);
}

/** Save or clear one file-backed key. An empty key removes it. */
export function writeFileEngineKey(dataDir: string, driver: string, envName: string, key: string): void {
  const file = readKeyFile(dataDir);
  const row = { ...file[driver] };
  if (key) row[envName] = key;
  else delete row[envName];
  if (Object.keys(row).length) file[driver] = row;
  else delete file[driver];
  atomicWrite(keyPath(dataDir), `${JSON.stringify(file)}\n`, 0o600);
}

/** Put a saved file key on an instance only when that instance did not
 * bring its own. Hermes reads its home `.env` instead: its driver removes
 * the variable from the child environment. */
export function applyStoredEngineEnv(environment: Record<string, string | undefined>, driver: string, dataDir: string): void {
  const target = FILE_KEYS[driver];
  if (!target || target.hermes || environment[target.env]) return;
  const key = readKeyFile(dataDir)[driver]?.[target.env];
  if (key) environment[target.env] = key;
}

/** Hermes reloads `~/.hermes/.env` itself and drops the variable from the
 * process environment, so the key is written there and nowhere else. */
export function writeHermesAccessKey(env: Record<string, string | undefined>, key: string): void {
  const home = harnessHome("hermes", env);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = join(home, ".env");
  refuseSymlink(path);
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const lines = text.split(/\n/).filter((line) => line.length > 0 && !line.startsWith("OPENROUTER_API_KEY="));
  if (key) lines.push(`OPENROUTER_API_KEY=${key}`);
  atomicWrite(path, lines.length ? `${lines.join("\n")}\n` : "", 0o600);
}

/** The config.json patch for a config-backed key. Empty clears it. */
export function configKeyPatch(target: Extract<EngineKeyTarget, { kind: "config" }>, key: string): Record<string, Record<string, string>> {
  return { [target.section]: { [target.field]: key } };
}

/** Remove a leftover temp file from a failed write. Best-effort. */
export function discardKeyTemp(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}
