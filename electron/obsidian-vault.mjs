// Settings > Memory > Open in Obsidian: open the organization memory folder
// as an Obsidian vault on the first click.
//
// obsidian://open?path=<folder> only works for a folder Obsidian already
// lists as a vault; for any other folder Obsidian answers "Vault not found".
// Obsidian (1.14) has no URL, command line or open-file event that adds a
// vault: its list lives in <appData>/obsidian/obsidian.json, read once at
// start and written back whole from memory. So:
//
//   - the folder (or a folder above it) is already a vault: open the URL;
//   - Obsidian is not running: add the folder to obsidian.json (every other
//     key and vault kept, written atomically), then open the URL, which
//     starts Obsidian on it;
//   - Obsidian is running: its list cannot be changed under it. Open its
//     vault chooser (obsidian://choose-vault) and tell the person to pick
//     "Open folder as vault"; the page also offers Show in Finder;
//   - no app handles obsidian://: say Obsidian is not installed.
//
// Everything that touches the system is injected for the tests.
import { randomBytes } from "node:crypto";
import nodeFs from "node:fs";
import path from "node:path";

export const OBSIDIAN_CONFIG = "obsidian.json";

/** The obsidian:// link that opens a vault folder Obsidian knows. */
export function obsidianOpenUrl(folder) {
  return `obsidian://open?path=${encodeURIComponent(folder)}`;
}

/** Obsidian's own settings folder (Electron userData of the app "obsidian"). */
export function obsidianConfigDir(appData) {
  return path.join(appData, "obsidian");
}

function readConfig(file, fs) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return error?.code === "ENOENT" ? {} : null;
  }
}

/** Whether `folder` is a registered vault or inside one. */
export function isRegisteredVault(config, folder) {
  const target = path.resolve(folder);
  const vaults = config && typeof config.vaults === "object" && config.vaults ? config.vaults : {};
  return Object.values(vaults).some((vault) => {
    if (!vault || typeof vault.path !== "string") return false;
    const root = path.resolve(vault.path);
    return target === root || target.startsWith(root + path.sep);
  });
}

/** Obsidian holds its single-instance lock (POSIX: the SingletonLock link
 * names `<host>-<pid>`). Unknown counts as running: never write then. */
export function obsidianRunning(configDir, { fs = nodeFs, platform = process.platform, alive = processAlive } = {}) {
  if (platform === "win32") return true;
  let target;
  try {
    target = fs.readlinkSync(path.join(configDir, "SingletonLock"));
  } catch (error) {
    return error?.code !== "ENOENT";
  }
  const pid = Number(String(target).split("-").pop());
  if (!Number.isInteger(pid) || pid <= 0) return true;
  return alive(pid);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Add `folder` to obsidian.json; false when the file is unreadable. */
export function registerVault(configDir, folder, { fs = nodeFs, now = () => Date.now(), id = () => randomBytes(8).toString("hex") } = {}) {
  const file = path.join(configDir, OBSIDIAN_CONFIG);
  const config = readConfig(file, fs);
  if (!config) return false;
  if (isRegisteredVault(config, folder)) return true;
  const vaults = config.vaults && typeof config.vaults === "object" ? { ...config.vaults } : {};
  let key = id();
  while (vaults[key]) key = id();
  vaults[key] = { path: path.resolve(folder), ts: now(), open: true };
  fs.mkdirSync(configDir, { recursive: true });
  const temp = `${file}.sagax-${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...config, vaults }));
  fs.renameSync(temp, file);
  return true;
}

/**
 * Open `folder` in Obsidian. Answers `{ ok: true }`, or `{ ok: false,
 * reason }`: `not_installed`, `add_vault` (Obsidian is open on its vault
 * chooser: the person adds the folder there) or `failed`.
 *
 * @param {object} deps
 * @param {string} deps.folder
 * @param {string} deps.appData   Electron's app.getPath("appData")
 * @param {() => boolean} deps.installed  an app handles obsidian://
 * @param {(url: string) => Promise<void>} deps.openUrl
 */
export async function openFolderInObsidian({ folder, appData, installed, openUrl, fs = nodeFs, platform = process.platform, alive = processAlive, now, id }) {
  if (!installed()) return { ok: false, reason: "not_installed" };
  const configDir = obsidianConfigDir(appData);
  const config = readConfig(path.join(configDir, OBSIDIAN_CONFIG), fs);
  try {
    if (config && isRegisteredVault(config, folder)) {
      await openUrl(obsidianOpenUrl(folder));
      return { ok: true };
    }
    if (!obsidianRunning(configDir, { fs, platform, alive }) && registerVault(configDir, folder, { fs, now, id })) {
      await openUrl(obsidianOpenUrl(folder));
      return { ok: true };
    }
    await openUrl("obsidian://choose-vault");
    return { ok: false, reason: "add_vault" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
