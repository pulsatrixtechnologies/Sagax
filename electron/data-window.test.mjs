import { describe, expect, it, vi } from "vitest";

import {
  createDataWindows,
  DATA_WINDOW_MIN,
  dataWindowNavigationAllowed,
  dataWindowUrl,
  MAX_DATA_WINDOWS,
  sanitizeDataWindowRequest,
} from "./data-window.mjs";

const ORIGIN = "http://127.0.0.1:48996";

function fakeElectron() {
  const handlers = new Map();
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.events = new Map();
      this.calls = [];
      const contentHandlers = new Map();
      this.webContents = {
        handlers: contentHandlers,
        setWindowOpenHandler: (fn) => { this.openHandler = fn; },
        on: (name, fn) => contentHandlers.set(name, [...(contentHandlers.get(name) ?? []), fn]),
        fire: (name, ...args) => (contentHandlers.get(name) ?? []).forEach((fn) => fn(...args)),
      };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; (this.events.get("closed") ?? []).forEach((fn) => fn()); }
    setTitle(title) { this.calls.push(["setTitle", title]); }
    isMinimized() { return false; }
    show() { this.calls.push(["show"]); }
    focus() { this.calls.push(["focus"]); }
    on(name, fn) { this.events.set(name, [...(this.events.get(name) ?? []), fn]); }
    once(name, fn) { this.on(name, fn); }
    fire(name, ...args) { (this.events.get(name) ?? []).forEach((fn) => fn(...args)); }
  }
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const main = { webContents: { getURL: () => `${ORIGIN}/` }, isDestroyed: () => false };
  return { BrowserWindow: FakeWindow, ipcMain, handlers, windows, main };
}

function setup({ enabled = true, trusted = true } = {}) {
  const fake = fakeElectron();
  const featureEnabled = vi.fn(async () => enabled);
  const openExternal = vi.fn();
  const controller = createDataWindows({
    BrowserWindow: fake.BrowserWindow,
    ipcMain: fake.ipcMain,
    getMainWindow: () => fake.main,
    isTrustedMain: () => trusted,
    featureEnabled,
    openExternal,
  });
  const fromMain = { sender: fake.main.webContents, senderFrame: { url: `${ORIGIN}/#bot=scout` } };
  return { ...fake, controller, featureEnabled, openExternal, fromMain };
}

describe("Data window requests", () => {
  it("keeps a bot id, a plain title and a card id, and nothing else", () => {
    expect(sanitizeDataWindowRequest({ botId: "scout", title: "Data: Scout", cardId: "c_1", extra: 1 })).toEqual({ botId: "scout", title: "Data: Scout", cardId: "c_1" });
    expect(sanitizeDataWindowRequest({ botId: "../etc", title: "x" })).toBeNull();
    expect(sanitizeDataWindowRequest({ botId: 3 })).toBeNull();
    expect(sanitizeDataWindowRequest(null)).toBeNull();
    expect(sanitizeDataWindowRequest({ botId: "scout", title: "a\nb", cardId: "bad id" })).toEqual({ botId: "scout", title: "a b" });
    expect(sanitizeDataWindowRequest({ botId: "scout" })).toEqual({ botId: "scout", title: "Data" });
  });

  it("loads the asking page's origin on the Data route and stays there", () => {
    expect(dataWindowUrl(ORIGIN, "scout", "c_1")).toBe(`${ORIGIN}/data-window#bot=scout&card=c_1`);
    expect(dataWindowNavigationAllowed(`${ORIGIN}/data-window#bot=other`, ORIGIN)).toBe(true);
    expect(dataWindowNavigationAllowed(`${ORIGIN}/`, ORIGIN)).toBe(false);
    expect(dataWindowNavigationAllowed("https://example.com/data-window", ORIGIN)).toBe(false);
    expect(dataWindowNavigationAllowed("not a url", ORIGIN)).toBe(false);
  });
});

describe("Data windows", () => {
  it("opens one sandboxed window per bot and brings it forward when asked again", async () => {
    const { controller, windows, fromMain, handlers } = setup();
    expect(handlers.has("data-window:open")).toBe(true);
    expect(await handlers.get("data-window:open")(fromMain, { botId: "scout", title: "Data: Scout", cardId: "c_1" })).toBe("created");
    expect(windows).toHaveLength(1);
    const [win] = windows;
    expect(win.options.webPreferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    expect(win.options.webPreferences.preload).toBeUndefined();
    expect(win.options.title).toBe("Data: Scout");
    expect(win.options.resizable).toBe(true);
    expect(win.options.minWidth).toBe(DATA_WINDOW_MIN.width);
    expect(win.loadURL).toHaveBeenCalledWith(`${ORIGIN}/data-window#bot=scout&card=c_1`);

    expect(await controller.open(fromMain, { botId: "scout", title: "Data: Scout 2" })).toBe("focused");
    expect(windows).toHaveLength(1);
    expect(win.calls).toContainEqual(["focus"]);
    expect(win.calls).toContainEqual(["setTitle", "Data: Scout 2"]);

    expect(await controller.open(fromMain, { botId: "atlas", title: "Data: Atlas" })).toBe("created");
    expect(windows).toHaveLength(2);
    expect(controller.list().sort()).toEqual(["atlas", "scout"]);

    // closed by the person: the next ask opens a new one
    win.close();
    expect(controller.list()).toEqual(["atlas"]);
    expect(await controller.open(fromMain, { botId: "scout", title: "Data: Scout" })).toBe("created");
    expect(windows).toHaveLength(3);
  });

  it("refuses while the experimental switch is off, or when it cannot be read", async () => {
    const off = setup({ enabled: false });
    expect(await off.controller.open(off.fromMain, { botId: "scout", title: "Data" })).toBe("refused");
    expect(off.featureEnabled).toHaveBeenCalledWith(ORIGIN);
    expect(off.windows).toHaveLength(0);

    const broken = setup();
    broken.featureEnabled.mockRejectedValueOnce(new Error("offline"));
    expect(await broken.controller.open(broken.fromMain, { botId: "scout", title: "Data" })).toBe("refused");
    expect(broken.windows).toHaveLength(0);
  });

  it("answers only the main window's own page", async () => {
    const untrusted = setup({ trusted: false });
    expect(await untrusted.controller.open(untrusted.fromMain, { botId: "scout" })).toBe("refused");
    const other = setup();
    // a Data window (same origin, but not the main window) cannot open another
    expect(await other.controller.open({ sender: {}, senderFrame: { url: `${ORIGIN}/data-window` } }, { botId: "scout" })).toBe("refused");
    expect(other.featureEnabled).not.toHaveBeenCalled();
    expect(await other.controller.open(other.fromMain, { botId: "bad id" })).toBe("refused");
    expect(other.windows).toHaveLength(0);
  });

  it("keeps the window on its route and sends other links to the system browser", async () => {
    const { controller, windows, fromMain, openExternal } = setup();
    await controller.open(fromMain, { botId: "scout", title: "Data: Scout" });
    const [win] = windows;
    const stay = { preventDefault: vi.fn() };
    win.webContents.fire("will-navigate", stay, `${ORIGIN}/data-window#bot=scout&card=c_2`);
    expect(stay.preventDefault).not.toHaveBeenCalled();
    const away = { preventDefault: vi.fn() };
    win.webContents.fire("will-navigate", away, "https://example.com/docs");
    expect(away.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
    const app = { preventDefault: vi.fn() };
    win.webContents.fire("will-redirect", app, `${ORIGIN}/`);
    expect(app.preventDefault).toHaveBeenCalled();
    expect(win.openHandler({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledTimes(1);
    const titled = { preventDefault: vi.fn() };
    win.fire("page-title-updated", titled);
    expect(titled.preventDefault).toHaveBeenCalled();
  });

  it("closes every window when the app quits, and the other server's when the main window moves", async () => {
    const { controller, windows, fromMain } = setup();
    await controller.open(fromMain, { botId: "scout" });
    await controller.open(fromMain, { botId: "atlas" });
    controller.mainNavigated(`${ORIGIN}/?thread=1`);
    expect(controller.list()).toHaveLength(2);
    controller.mainNavigated("https://org.example.com/");
    expect(controller.list()).toEqual([]);
    expect(windows.every((win) => win.isDestroyed())).toBe(true);

    await controller.open(fromMain, { botId: "scout" });
    controller.closeAll();
    expect(controller.list()).toEqual([]);
    expect(windows.at(-1).isDestroyed()).toBe(true);
  });

  it("caps how many windows are open at once", async () => {
    const { controller, fromMain } = setup();
    for (let i = 0; i < MAX_DATA_WINDOWS; i++) expect(await controller.open(fromMain, { botId: `bot${i}` })).toBe("created");
    expect(await controller.open(fromMain, { botId: "one-more" })).toBe("refused");
  });
});
