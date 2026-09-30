// The rename to Sagax is on-screen only: the data folder (credentials.bin
// and every other desktop store) and the keychain secret stay where they are.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { USER_DATA_FOLDER, keepUserDataInPlace, pinnedUserDataPath } from "./user-data-location.mjs";

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
  it("keeps the runtime name that names the data folder and the keychain secret", () => {
    // Electron names the app after package.json productName, else name, and
    // electron-builder copies package.json unchanged. Adding a productName
    // here, or renaming the package, would move ~/Library/Application
    // Support/openmausbot and orphan the "openmausbot Safe Storage" secret.
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.name).toBe(USER_DATA_FOLDER);
    expect(pkg).not.toHaveProperty("productName");
    const builder = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(/^productName: Sagax$/m);
    expect(builder).not.toMatch(/^extraMetadata:/m);
  });

  it("is exactly where it was before the rename", () => {
    const app = fakeApp({ name: "openmausbot" });
    expect(keepUserDataInPlace(app, { platform: "darwin", home: "/Users/u" })).toBeNull();
    expect(app.getPath("userData")).toBe(path.join(appData, "openmausbot"));
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.setAppLogsPath).not.toHaveBeenCalled();
  });

  it("pulls a default that moved with a new app name back to the old folder", () => {
    for (const name of ["Sagax", "Pulsatrix Sagax"]) {
      const app = fakeApp({ name });
      expect(keepUserDataInPlace(app, { platform: "darwin", home: "/Users/u" })).toBe(path.join(appData, "openmausbot"));
      expect(app.getPath("userData")).toBe(path.join(appData, "openmausbot"));
      expect(app.setAppLogsPath).toHaveBeenCalledWith(path.join("/Users/u", "Library", "Logs", "openmausbot"));
    }
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
