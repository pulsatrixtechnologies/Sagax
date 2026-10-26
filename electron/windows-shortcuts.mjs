// Windows shortcuts and the taskbar (Settings > Appearance > App icon, #1004).
// A running window shows its own icon (BrowserWindow.setIcon), but once the
// window carries the install's AppUserModelId the taskbar draws the icon of
// the shortcut that owns that id: the pinned .lnk, or the Start menu one.
// That icon is stored in the .lnk, so a runtime setIcon never reaches it and
// the old icon stayed, even after a restart. This module gives the process
// the install's AppUserModelId (the one electron-builder stamps on every
// shortcut and pin) and points those shortcuts at the chosen icon, or back at
// Sagax.exe's own icon for the default. Only .lnk files whose target is this
// executable are touched.
import fs from "node:fs";
import path from "node:path";

/** electron-builder.yml appId: pinned by packaging-windows.node-test.mjs. */
export const WINDOWS_APP_USER_MODEL_ID = "com.openmausbot.app";

const sameFile = (a, b) => typeof a === "string" && typeof b === "string" && path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();

/** Folders that hold the install's shortcuts (desktop, Start menu, taskbar pins). */
export function shortcutFolders({ appData, desktop }) {
  const folders = [];
  if (desktop) folders.push(desktop);
  if (appData) {
    folders.push(path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"));
    folders.push(path.win32.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"));
  }
  return folders;
}

/**
 * Point every shortcut that launches `exePath` at `iconPath` (null restores
 * the executable's own icon). Returns the shortcuts that changed. A shortcut
 * that cannot be read or written (locked, no rights) is skipped.
 */
export function updateShortcutIcons({ shell, fsImpl = fs, folders, exePath, iconPath = null }) {
  const wanted = iconPath ?? exePath;
  const changed = [];
  for (const folder of folders) {
    let names;
    try {
      names = fsImpl.readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.lnk$/i.test(name)) continue;
      const link = path.win32.join(folder, name);
      try {
        const current = shell.readShortcutLink(link);
        if (!sameFile(current?.target, exePath)) continue;
        if (sameFile(current.icon, wanted) && (current.iconIndex ?? 0) === 0) continue;
        if (shell.writeShortcutLink(link, "update", { icon: wanted, iconIndex: 0 })) changed.push(link);
      } catch {
        /* skip this shortcut */
      }
    }
  }
  return changed;
}
