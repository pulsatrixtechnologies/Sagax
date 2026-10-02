// Where the desktop app keeps its data, whatever it is called on screen.
//
// Electron derives three things from the app's name: the userData folder
// (credentials.bin, window state, cookies, the cloud and company stores),
// the macOS logs folder, and the name of the safeStorage secret in the
// macOS keychain / Linux secret service ("<name> Safe Storage"). The name
// comes from package.json at runtime (productName, else name), and
// electron-builder copies package.json as is: its own `productName` setting
// renames the bundle, the Dock and the installer, not the runtime name.
//
// The runtime name stays "openmausbot" for now (RUNTIME_NAME): renaming it
// would look for a new keychain entry that cannot decrypt credentials.bin
// (keychain-migration.mjs copies it over, for the day the name changes).
// The folder is pinned here instead, so it no longer follows the name: it is
// "sagax", moved once from "openmausbot" when no running copy holds that
// one (legacy-names.mjs migrateLegacyDir), else the old folder stays in use.
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrateLegacyDir } from "./legacy-names.mjs";

/** The runtime app name (package.json "name"), which names the keychain secret. */
export const RUNTIME_NAME = "openmausbot";
/** The userData folder name, and the one it is moved from. */
export const USER_DATA_FOLDER = "sagax";
export const LEGACY_USER_DATA_FOLDER = "openmausbot";

/**
 * Whether a running Chromium holds `dir`: its SingletonLock link reads
 * "<host>-<pid>" (macOS, Linux). Windows has no such link; there the folder
 * of a running copy cannot be renamed, so the move fails and nothing moves.
 */
export function userDataInUse(dir, { fs = nodeFs, hostname = os.hostname() } = {}) {
  let target;
  try {
    target = fs.readlinkSync(path.join(dir, "SingletonLock"));
  } catch (error) {
    return error?.code !== "ENOENT";
  }
  const match = /^(.*)-(\d+)$/.exec(target);
  if (!match) return true;
  if (match[1] !== hostname) return true;
  try {
    process.kill(Number(match[2]), 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

/** The folder in use: "sagax", after moving "openmausbot" to it when possible. */
export function resolveUserDataFolder({ appData, fs = nodeFs, log = () => {}, isBusy = (dir) => userDataInUse(dir, { fs }) }) {
  const target = path.join(appData, USER_DATA_FOLDER);
  const legacy = path.join(appData, LEGACY_USER_DATA_FOLDER);
  let outcome;
  try {
    outcome = migrateLegacyDir({ target, legacy, isBusy, fs, log });
  } catch (error) {
    log(`userData: could not move ${legacy} (${error?.message ?? error}); still using it`);
    return legacy;
  }
  return outcome === "busy" || outcome === "failed" ? legacy : target;
}

/**
 * The userData path to force, or null to leave Electron's choice alone.
 * Only the untouched default is corrected: a folder someone chose on
 * purpose (a harness's app.setPath, --user-data-dir) is theirs.
 */
export function pinnedUserDataPath({ name, appData, userData, resolve = () => path.join(appData, USER_DATA_FOLDER) }) {
  const defaults = new Set([path.join(appData, name), path.join(appData, USER_DATA_FOLDER), path.join(appData, LEGACY_USER_DATA_FOLDER)]);
  if (!defaults.has(userData)) return null;
  const expected = resolve();
  return userData === expected ? null : expected;
}

/** Call once, first thing in main, before anything reads userData or logs. */
export function keepUserDataInPlace(app, { platform = process.platform, home = os.homedir(), fs = nodeFs, log = (line) => console.warn(line) } = {}) {
  const appData = app.getPath("appData");
  const pinned = pinnedUserDataPath({
    name: app.getName(),
    appData,
    userData: app.getPath("userData"),
    resolve: () => resolveUserDataFolder({ appData, fs, log }),
  });
  if (!pinned) return null;
  app.setPath("userData", pinned);
  // macOS keeps logs outside userData, under the folder's name as well
  if (platform === "darwin") app.setAppLogsPath(path.join(home, "Library", "Logs", path.basename(pinned)));
  return pinned;
}
