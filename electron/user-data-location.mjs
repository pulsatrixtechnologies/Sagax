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
// So the app is "Sagax" on screen and "openmausbot" underneath, and must
// stay "openmausbot" underneath: a new folder would look like a fresh
// install and a new keychain entry could not decrypt credentials.bin.
// keepUserDataInPlace() is the belt to that brace: if anything ever gives
// the runtime a different name, the data still loads from the same folder.
// (The keychain entry cannot be pinned this way, so the package.json test
// in user-data-location.test.mjs guards the name itself.)
import os from "node:os";
import path from "node:path";

/** The runtime app name, and so the userData folder name, since the start. */
export const USER_DATA_FOLDER = "openmausbot";

/**
 * The userData path to force, or null to leave Electron's choice alone.
 * Only the untouched default is corrected: a folder someone chose on
 * purpose (a harness's app.setPath, --user-data-dir) is theirs.
 */
export function pinnedUserDataPath({ name, appData, userData }) {
  const expected = path.join(appData, USER_DATA_FOLDER);
  if (userData === expected) return null;
  if (userData !== path.join(appData, name)) return null;
  return expected;
}

/** Call once, first thing in main, before anything reads userData or logs. */
export function keepUserDataInPlace(app, { platform = process.platform, home = os.homedir() } = {}) {
  const pinned = pinnedUserDataPath({
    name: app.getName(),
    appData: app.getPath("appData"),
    userData: app.getPath("userData"),
  });
  if (!pinned) return null;
  app.setPath("userData", pinned);
  // macOS keeps logs outside userData, under the app name as well
  if (platform === "darwin") app.setAppLogsPath(path.join(home, "Library", "Logs", USER_DATA_FOLDER));
  return pinned;
}
