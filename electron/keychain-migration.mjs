// The safeStorage secret follows the runtime app name: Chromium keeps it in
// the macOS keychain as service "<name> Safe Storage", account "<name> Key".
// The day the runtime name changes from "openmausbot" (user-data-location.mjs
// RUNTIME_NAME), the new name must find the same secret or credentials.bin
// and the cookies cannot be decrypted. This reads the new service first and,
// when only the old one exists, copies its secret over before safeStorage is
// first used. The old entry is left in place.
//
// Windows keeps the key in "Local State" inside userData (moved with the
// folder); Linux secret services are not handled here (they fall back to a
// fresh store, which credentials.bin reports as unavailable, never empty).
import { spawnSync } from "node:child_process";

export const LEGACY_KEYCHAIN_NAME = "openmausbot";
const SECURITY = "/usr/bin/security";
/** Chromium's secret is base64 text; anything else is not copied. */
const SECRET = /^[A-Za-z0-9+/=]{8,256}$/;

export const safeStorageService = (name) => `${name} Safe Storage`;
export const safeStorageAccount = (name) => `${name} Key`;

function defaultRun(args, input) {
  const result = spawnSync(SECURITY, args, { input, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "ignore"] });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

const quoted = (value) => `"${String(value).replace(/["\\]/g, "\\$&")}"`;

/**
 * Make "<to> Safe Storage" exist on macOS, copied from "<from> Safe Storage".
 * Returns "same" (no rename), "unsupported" (not macOS), "present" (the new
 * entry exists), "none" (no old entry either), "copied" or "failed".
 * `trustedApp` is added to the new entry's access list so the app reads it
 * without a keychain prompt. The secret is passed on stdin, never in argv.
 */
export function migrateSafeStorageKeychain({ from = LEGACY_KEYCHAIN_NAME, to, platform = process.platform, run = defaultRun, trustedApp = process.execPath, log = () => {} }) {
  if (!to || to === from) return "same";
  if (platform !== "darwin") return "unsupported";
  if (run(["find-generic-password", "-s", safeStorageService(to), "-a", safeStorageAccount(to)]).status === 0) return "present";
  const old = run(["find-generic-password", "-s", safeStorageService(from), "-a", safeStorageAccount(from), "-w"]);
  if (old.status !== 0) return "none";
  const secret = old.stdout.trim();
  if (!SECRET.test(secret)) {
    log("keychain: the old safeStorage entry has an unexpected shape; not copied");
    return "failed";
  }
  const command = ["add-generic-password", "-s", quoted(safeStorageService(to)), "-a", quoted(safeStorageAccount(to)), "-T", quoted(trustedApp), "-w", quoted(secret)].join(" ");
  const added = run(["-i"], `${command}\n`);
  if (added.status !== 0) {
    log("keychain: could not copy the safeStorage entry to its new name");
    return "failed";
  }
  log(`keychain: copied "${safeStorageService(from)}" to "${safeStorageService(to)}"`);
  return "copied";
}
