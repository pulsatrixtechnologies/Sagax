import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import localOriginModule from "./local-origin.cjs";

const LOCAL = "http://127.0.0.1:8799";
const OTHER = "https://bots.example.test";

const fixture = vi.hoisted(() => ({ autoUpdater: null, handlers: new Map() }));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => "/unused-updater-test-log" },
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: (name, handler) => fixture.handlers.set(name, handler) },
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({ autoUpdater: fixture.autoUpdater }),
}));

/** A page in the main window: its contents, and an IPC event it sends. */
function page(origin) {
  const mainFrame = { url: `${origin}/` };
  const webContents = { mainFrame, send: vi.fn() };
  return { webContents, event: { sender: webContents, senderFrame: mainFrame } };
}

/** main.mjs's rule: this app's own UI (local-origin.cjs isDesktopUiSender). */
const pageAllowed = (event) => localOriginModule.isDesktopUiSender(event);

/** A fresh updater module with a fake electron-updater behind it. */
async function load(allowed = pageAllowed) {
  vi.resetModules();
  fixture.handlers.clear();
  const autoUpdater = new EventEmitter();
  autoUpdater.checkForUpdates = vi.fn(async () => {
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "2.0.0" });
    return { isUpdateAvailable: true };
  });
  autoUpdater.downloadUpdate = vi.fn(async () => {
    autoUpdater.emit("download-progress", { percent: 50 });
    autoUpdater.emit("update-downloaded", { version: "2.0.0" });
    return ["/unused-staged-update.zip"];
  });
  autoUpdater.quitAndInstall = vi.fn();
  autoUpdater.setFeedURL = vi.fn();
  fixture.autoUpdater = autoUpdater;
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: allowed });
  return { updater, autoUpdater, handlers: fixture.handlers };
}

const settle = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

beforeEach(() => {
  localOriginModule.setLocalOrigin(LOCAL);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("main wires the updater to this app's own UI only", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  expect(source).toContain("registerUpdaterIpc({ pageAllowed: updaterPageAllowed });");
  expect(source).toContain("const updaterPageAllowed = (event) => isDesktopUiSender(event);");
});

it("pins the feed to Sagax's GitHub releases with pre-releases off by default", async () => {
  const { updater, autoUpdater } = await load();
  updater.startUpdater();
  expect(autoUpdater.setFeedURL).toHaveBeenLastCalledWith({ provider: "github", owner: "pulsatrixtechnologies", repo: "sagax" });
  expect(autoUpdater.allowPrerelease).toBe(false);
  expect(autoUpdater.allowDowngrade).toBe(false);
  expect(autoUpdater.fullChangelog).toBe(true);
});

it("a downloaded update installs when the app quits, except a system package, which is the person's to install", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const resourcesPath = process.resourcesPath;
  const appImage = process.env.APPIMAGE;
  const resources = mkdtempSync(join(tmpdir(), "sagax-updater-package-"));
  try {
    for (const [os, marker, image, installsOnQuit] of [
      ["darwin", null, null, true],
      ["win32", null, null, true],
      ["linux", null, "/home/a/Sagax.AppImage", true],
      ["linux", "deb", null, false],
      ["linux", "rpm", null, false],
    ]) {
      Object.defineProperty(process, "platform", { ...platform, value: os });
      process.resourcesPath = resources;
      rmSync(join(resources, "package-type"), { force: true });
      if (marker) writeFileSync(join(resources, "package-type"), marker);
      if (image) process.env.APPIMAGE = image;
      else delete process.env.APPIMAGE;
      const { updater, autoUpdater } = await load(() => false);
      updater.startUpdater();
      expect(autoUpdater.autoInstallOnAppQuit, `${os} ${marker ?? image ?? ""}`).toBe(installsOnQuit);
      // Nothing is installed by itself before then: the coordinator owns the download.
      expect(autoUpdater.autoDownload).toBe(false);
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
    process.resourcesPath = resourcesPath;
    if (appImage === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = appImage;
    rmSync(resources, { recursive: true, force: true });
  }
});

it("downloads an update by itself: the first check after launch starts it, and nothing restarts", async () => {
  const local = page(LOCAL);
  const { updater, autoUpdater } = await load();
  updater.attachUpdaterWindow({ webContents: local.webContents });
  updater.startUpdater();

  await vi.advanceTimersByTimeAsync(15_000);
  await settle();

  expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  const statuses = local.webContents.send.mock.calls.map(([, state]) => state.status);
  expect(statuses).not.toContain("available");
  expect(statuses.at(-1)).toBe("downloaded");
});

it("this app's own page reads and drives the update channels; another server's page is refused", async () => {
  const { handlers } = await load();
  expect([...handlers.keys()].sort()).toEqual(["update:check", "update:download", "update:get-state", "update:install", "update:set-prereleases"]);
  const local = page(LOCAL);
  expect(() => handlers.get("update:get-state")(local.event)).not.toThrow();
  const other = page(OTHER);
  for (const channel of handlers.keys()) expect(() => handlers.get(channel)(other.event), channel).toThrow(/only available/);
});

it("sends update news only to a page allowed to read it", async () => {
  const other = page(OTHER);
  const { updater, autoUpdater, handlers } = await load();
  updater.attachUpdaterWindow({ webContents: other.webContents });
  updater.startUpdater();
  await vi.advanceTimersByTimeAsync(15_000);
  await settle();
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(other.webContents.send).not.toHaveBeenCalled();
  expect(() => handlers.get("update:get-state")(other.event)).toThrow(/only available/);
});

it("sends updater progress to a reopened window without restarting the updater", async () => {
  const first = page(LOCAL);
  const { updater, autoUpdater, handlers } = await load();
  updater.attachUpdaterWindow({ webContents: first.webContents });
  updater.startUpdater();
  const listenerCount = autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0);
  const timerCount = vi.getTimerCount();

  first.webContents.send.mockImplementation(() => { throw new Error("window destroyed"); });
  first.webContents.send.mockClear();
  const reopened = page(LOCAL);
  updater.attachUpdaterWindow({ webContents: reopened.webContents });

  await handlers.get("update:check")(reopened.event);
  await settle();

  expect(first.webContents.send).not.toHaveBeenCalled();
  expect(reopened.webContents.send.mock.calls.map(([, state]) => state.status))
    .toEqual(["checking", "downloading", "downloading", ...(process.platform === "darwin" ? ["preparing"] : []), "downloaded"]);
  expect(handlers.get("update:get-state")(reopened.event)).toMatchObject({ status: "downloaded", version: "2.0.0" });
  expect(autoUpdater.eventNames().reduce((count, name) => count + autoUpdater.listenerCount(name), 0)).toBe(listenerCount);
  expect(vi.getTimerCount()).toBe(timerCount);
});
