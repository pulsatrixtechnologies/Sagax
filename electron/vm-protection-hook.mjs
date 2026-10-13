// Security agent on persistent local virtual machines: a generic, configurable
// install / health / rollback hook.
//
// Nothing here names or calls a specific product. An operator points the hook
// at their own install script or package through environment variables:
//
//   SAGAX_VM_AGENT_INSTALL_SCRIPT   host path of a shell script copied into the
//                                   guest and run as the install step
//   SAGAX_VM_AGENT_PACKAGE          host path of an installer package copied
//                                   into the guest (exposed to the script as
//                                   $AGENT_PACKAGE)
//   SAGAX_VM_AGENT_PACKAGE_SHA256   required hex SHA-256 of the package; the
//                                   hook refuses to copy a package that does
//                                   not match
//   SAGAX_VM_AGENT_HEALTH_SCRIPT    script whose exit code 0 means healthy
//   SAGAX_VM_AGENT_ROLLBACK_SCRIPT  script run when install or health fails
//   SAGAX_VM_AGENT_SECRET           optional enrollment secret; written to a
//                                   root-only file in the guest (path in
//                                   $AGENT_SECRET_FILE), removed afterwards and
//                                   redacted from every result
//   SAGAX_VM_AGENT_TIMEOUT_MS       health wait limit (default 60000)
//
// The guest is reached only through an injected `guest` object, so tests run
// with a fake and the module never touches a real machine on its own.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const ENV_PREFIX = "SAGAX_VM_AGENT_";
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_POLL_MS = 2_000;
export const SECRET_MAX = 4096;
export const GUEST_DIR = "/run/sagax-vm-agent";

const SHA256 = /^[a-f0-9]{64}$/;

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Absent or any value other than false: a long-lived virtual machine. */
export function vmIsPersistent(target) {
  return !target || target.persistent !== false;
}

/**
 * Read the hook configuration from the environment. Returns
 * `{ enabled: false }` when no install step is configured, and
 * `{ enabled: false, error }` when the configuration is unsafe.
 */
export function readHookConfig(env = process.env) {
  const installScript = clean(env?.[`${ENV_PREFIX}INSTALL_SCRIPT`]);
  const packagePath = clean(env?.[`${ENV_PREFIX}PACKAGE`]);
  const sha = clean(env?.[`${ENV_PREFIX}PACKAGE_SHA256`])?.toLowerCase();
  const healthScript = clean(env?.[`${ENV_PREFIX}HEALTH_SCRIPT`]);
  const rollbackScript = clean(env?.[`${ENV_PREFIX}ROLLBACK_SCRIPT`]);
  const rawSecret = env?.[`${ENV_PREFIX}SECRET`];
  const timeoutRaw = Number(env?.[`${ENV_PREFIX}TIMEOUT_MS`]);
  if (!installScript) return { enabled: false };
  if (packagePath && !sha) return { enabled: false, error: "A package needs SAGAX_VM_AGENT_PACKAGE_SHA256." };
  if (sha && !SHA256.test(sha)) return { enabled: false, error: "SAGAX_VM_AGENT_PACKAGE_SHA256 is not a SHA-256 hex digest." };
  let secret;
  if (typeof rawSecret === "string" && rawSecret.trim()) {
    if (/[\r\n\0]/.test(rawSecret) || rawSecret.trim().length > SECRET_MAX) {
      return { enabled: false, error: "SAGAX_VM_AGENT_SECRET is not a single line." };
    }
    secret = rawSecret.trim();
  }
  return {
    enabled: true,
    installScript,
    packagePath,
    packageSha256: sha,
    healthScript,
    rollbackScript,
    secret,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS,
  };
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True only when `bytes` hash to `expected` (hex, any case). */
export function checksumMatches(bytes, expected) {
  const want = clean(expected)?.toLowerCase();
  return Boolean(want && SHA256.test(want) && sha256Hex(bytes) === want);
}

export function redact(text, secret) {
  const value = typeof text === "string" ? text : text == null ? "" : String(text);
  return secret ? value.split(secret).join("[hidden]") : value;
}

function tail(text, secret) {
  return redact(text, secret).split("\n").map((l) => l.trim()).filter(Boolean).slice(-5).join("\n");
}

/**
 * Run install → health → (rollback on failure) inside a persistent guest.
 *
 * `guest` must provide:
 *   exec(command, { stdin?, env? }) → { code, stdout, stderr }
 *   writeFile(path, bytes, { mode })  copies bytes into the guest
 *
 * Returns { status: "skipped" | "healthy" | "rolled-back" | "failed", step, detail }.
 */
export async function runProtectionHook({
  target,
  guest,
  env = process.env,
  config = readHookConfig(env),
  readHostFile = readFile,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  pollMs = DEFAULT_POLL_MS,
} = {}) {
  if (!vmIsPersistent(target)) return { status: "skipped", step: "persistent", detail: "Not a persistent machine." };
  if (config.error) return { status: "failed", step: "config", detail: config.error };
  if (!config.enabled) return { status: "skipped", step: "config", detail: "No install hook configured." };
  const secret = config.secret;
  const dir = GUEST_DIR;
  const secretFile = `${dir}/enroll.secret`;
  const hookEnv = { AGENT_DIR: dir };

  const run = async (path) => {
    const r = await guest.exec(`sh ${path}`, { env: hookEnv });
    return { code: r?.code ?? 1, out: tail(`${r?.stdout ?? ""}\n${r?.stderr ?? ""}`, secret) };
  };
  const copyScript = async (hostPath, name) => {
    const bytes = await readHostFile(hostPath);
    await guest.writeFile(`${dir}/${name}`, bytes, { mode: 0o700 });
    return `${dir}/${name}`;
  };
  const wipeSecret = async () => {
    if (!secret) return true;
    await guest.exec(`rm -f ${secretFile}`);
    const left = await guest.exec(`test -e ${secretFile}`);
    return left?.code !== 0;
  };
  const rollback = async (step, detail) => {
    await wipeSecret();
    if (!config.rollbackScript) return { status: "failed", step, detail };
    const path = await copyScript(config.rollbackScript, "rollback.sh");
    const r = await run(path);
    return r.code === 0
      ? { status: "rolled-back", step, detail }
      : { status: "failed", step, detail: `${detail}\nRollback failed: ${r.out}` };
  };

  try {
    await guest.exec(`mkdir -p ${dir} && chmod 700 ${dir}`);
    if (config.packagePath) {
      const bytes = await readHostFile(config.packagePath);
      if (!checksumMatches(bytes, config.packageSha256)) {
        return { status: "failed", step: "checksum", detail: "The package does not match SAGAX_VM_AGENT_PACKAGE_SHA256." };
      }
      const name = config.packagePath.split(/[\\/]/).pop() || "agent.pkg";
      await guest.writeFile(`${dir}/${name}`, bytes, { mode: 0o600 });
      hookEnv.AGENT_PACKAGE = `${dir}/${name}`;
    }
    if (secret) {
      await guest.exec(`umask 077; cat > ${secretFile}`, { stdin: secret });
      hookEnv.AGENT_SECRET_FILE = secretFile;
    }
    const install = await run(await copyScript(config.installScript, "install.sh"));
    if (!(await wipeSecret())) return rollback("secret", "The enrollment secret was still in the machine after install.");
    if (install.code !== 0) return rollback("install", install.out || `Install exited with ${install.code}.`);
    if (!config.healthScript) return { status: "healthy", step: "install", detail: install.out };
    const health = await copyScript(config.healthScript, "health.sh");
    const deadline = now() + config.timeoutMs;
    let last = "";
    for (;;) {
      const r = await run(health);
      if (r.code === 0) return { status: "healthy", step: "health", detail: r.out };
      last = r.out;
      if (now() + pollMs > deadline) break;
      await sleep(pollMs);
    }
    return rollback("health", last || "The agent did not report healthy before the time limit.");
  } catch (error) {
    return rollback("error", redact(error?.message ?? String(error), secret));
  }
}
