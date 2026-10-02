// The rename to Sagax is on-screen only: the data folder (credentials.bin
// and every other desktop store) and the keychain secret stay where they are.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { RUNTIME_NAME, USER_DATA_FOLDER, keepUserDataInPlace, pinnedUserDataPath, resolveUserDataFolder, userDataInUse } from "./user-data-location.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = "/Users/u/Library/Application Support";

function fakeApp({ name, userData }) {
  const paths = { appData, userData: userData ?? path.join(appData, name) };
  return {
    getName: () => name,
    getPath: (key) => paths[key],
    setPath: vi.fn((key, value) => {
      paths[key] = value;
    }),
    setAppLogsPath: vi.fn(),
  };
}

describe("userData location", () => {
  it("keeps the runtime name that names the keychain secret", () => {
    // Electron names the app after package.json productName, else name, and
    // electron-builder copies package.json unchanged. Adding a productName
    // here, or renaming the package, would orphan the "openmausbot Safe
    // Storage" secret (keychain-migration.mjs is ready for that day).
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe(RUNTIME_NAME);
    expect(pkg).not.toHaveProperty("productName");
    const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/^productName: Sagax$/m);
    expect(builder).not.toMatch(/^extraMetadata:/m);
  });

  it("moves the old folder to sagax once, then stays there", () => {
    const realAppData = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-userdata-"));
    try {
      const legacy = path.join(realAppData, "openmausbot");
      fs.mkdirSync(legacy);
      fs.writeFileSync(path.join(legacy, "credentials.bin"), "sealed");
      const paths = { appData: realAppData, userData: legacy };
      const app = { getName: () => "openmausbot", getPath: (key) => paths[key], setPath: vi.fn((key, value) => { paths[key] = value; }), setAppLogsPath: vi.fn() };
      const moved = keepUserDataInPlace(app, { platform: "darwin", home: "/Users/u", log: () => {} });
      expect(moved).toBe(path.join(realAppData, "sagax"));
      expect(fs.readFileSync(path.join(moved, "credentials.bin"), "utf8")).toBe("sealed");
      expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
      expect(app.setAppLogsPath).toHaveBeenCalledWith(path.join("/Users/u", "Library", "Logs", "sagax"));
      paths.userData = legacy;
      expect(keepUserDataInPlace(app, { platform: "darwin", home: "/Users/u", log: () => {} })).toBe(moved);
    } finally {
      fs.rmSync(realAppData, { recursive: true, force: true });
    }
  });

  it("keeps the old folder while a running copy holds it", () => {
    const realAppData = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-userdata-"));
    try {
      const legacy = path.join(realAppData, "openmausbot");
      fs.mkdirSync(legacy);
      fs.symlinkSync(`${os.hostname()}-${process.pid}`, path.join(legacy, "SingletonLock"));
      expect(userDataInUse(legacy)).toBe(true);
      expect(resolveUserDataFolder({ appData: realAppData })).toBe(legacy);
      expect(fs.existsSync(path.join(realAppData, "sagax"))).toBe(false);
    } finally {
      fs.rmSync(realAppData, { recursive: true, force: true });
    }
  });

  it("pulls a default that moved with a new app name to the pinned folder", () => {
    for (const name of ["Sagax", "Pulsatrix Sagax", "openmausbot"]) {
      expect(pinnedUserDataPath({ name, appData, userData: path.join(appData, name) })).toBe(path.join(appData, USER_DATA_FOLDER));
    }
    expect(pinnedUserDataPath({ name: "Sagax", appData, userData: path.join(appData, "sagax") })).toBeNull();
  });

  it("leaves a folder chosen on purpose alone", () => {
    const chosen = "/tmp/harness/user-data";
    expect(pinnedUserDataPath({ name: "Sagax", appData, userData: chosen })).toBeNull();
    const app = fakeApp({ name: "Sagax", userData: chosen });
    expect(keepUserDataInPlace(app)).toBeNull();
    expect(app.getPath("userData")).toBe(chosen);
  });

  it("runs in main before anything reads userData", () => {
    const main = fs.readFileSync(path.join(root, "electron/main.mjs"), "utf8");
    const call = main.indexOf("keepUserDataInPlace(app);");
    expect(call).toBeGreaterThan(0);
    const firstRead = main.search(/app\.getPath\("(userData|logs)"\)/);
    expect(firstRead).toBeGreaterThan(call);
    expect(main).not.toMatch(/app\.setName\(|app\.name\s*=/);
  });
});
