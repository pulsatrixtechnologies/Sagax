import assert from "node:assert/strict";
import test from "node:test";
import { WINDOWS_APP_USER_MODEL_ID, shortcutFolders, updateShortcutIcons } from "./windows-shortcuts.mjs";

const EXE = "C:\\Users\\a\\AppData\\Local\\Programs\\openmausbot\\Sagax.exe";
const ICO = "C:\\Users\\a\\AppData\\Roaming\\Sagax\\app-icon\\icon-0.ico";

function fake(links) {
  const writes = [];
  return {
    writes,
    fsImpl: {
      readdirSync: (folder) => {
        const names = Object.keys(links).filter((link) => link.startsWith(`${folder}\\`)).map((link) => link.slice(folder.length + 1));
        if (!names.length && !folder.includes("Start Menu")) throw new Error("ENOENT");
        return names;
      },
    },
    shell: {
      readShortcutLink: (link) => {
        if (!links[link]) throw new Error("gone");
        return links[link];
      },
      writeShortcutLink: (link, op, details) => {
        writes.push({ link, op, details });
        return true;
      },
    },
  };
}

test("the AppUserModelId is the installer's appId", () => {
  assert.equal(WINDOWS_APP_USER_MODEL_ID, "com.openmausbot.app");
});

test("looks in the desktop, Start menu and taskbar pin folders", () => {
  const folders = shortcutFolders({ appData: "C:\\Users\\a\\AppData\\Roaming", desktop: "C:\\Users\\a\\Desktop" });
  assert.equal(folders.length, 3);
  assert.ok(folders[1].endsWith("Start Menu\\Programs"));
  assert.ok(folders[2].endsWith("User Pinned\\TaskBar"));
});

test("points our shortcuts at the chosen icon, and leaves other programs alone", () => {
  const links = {
    "C:\\Desk\\Pulsatrix Sagax.lnk": { target: EXE.toLowerCase(), icon: EXE, iconIndex: 0 },
    "C:\\Desk\\Other.lnk": { target: "C:\\Other\\other.exe", icon: "C:\\Other\\other.exe", iconIndex: 0 },
    "C:\\Desk\\notes.txt": { target: EXE },
  };
  const { shell, fsImpl, writes } = fake(links);
  const changed = updateShortcutIcons({ shell, fsImpl, folders: ["C:\\Desk", "C:\\Missing"], exePath: EXE, iconPath: ICO });
  assert.deepEqual(changed, ["C:\\Desk\\Pulsatrix Sagax.lnk"]);
  assert.deepEqual(writes, [{ link: "C:\\Desk\\Pulsatrix Sagax.lnk", op: "update", details: { icon: ICO, iconIndex: 0 } }]);
});

test("restores the executable's icon on reset, and writes nothing when already right", () => {
  const links = { "C:\\Desk\\Sagax.lnk": { target: EXE, icon: ICO, iconIndex: 0 } };
  const first = fake(links);
  updateShortcutIcons({ ...first, folders: ["C:\\Desk"], exePath: EXE, iconPath: null });
  assert.deepEqual(first.writes[0].details, { icon: EXE, iconIndex: 0 });
  const again = fake({ "C:\\Desk\\Sagax.lnk": { target: EXE, icon: EXE, iconIndex: 0 } });
  assert.deepEqual(updateShortcutIcons({ ...again, folders: ["C:\\Desk"], exePath: EXE, iconPath: null }), []);
  assert.equal(again.writes.length, 0);
});

test("a shortcut that cannot be written is skipped, not fatal", () => {
  const { fsImpl } = fake({ "C:\\Desk\\Sagax.lnk": { target: EXE } });
  const shell = { readShortcutLink: () => ({ target: EXE, icon: EXE }), writeShortcutLink: () => { throw new Error("EPERM"); } };
  assert.deepEqual(updateShortcutIcons({ shell, fsImpl, folders: ["C:\\Desk"], exePath: EXE, iconPath: ICO }), []);
});
