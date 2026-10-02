import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_MAX,
  createFloatingBotWindows,
  FLOAT_MAX,
  FLOATING_QUERY,
  floatingDefaultBounds,
  MAX_FLOATING,
  READY_TIMEOUT_MS,
  REMEMBER_DELAY_MS,
  waitForPage,
  sanitizeCall,
  menuPopupPoint,
  sanitizeFloatingEvent,
  sanitizeFloatingSnapshot,
  sanitizePositions,
  mascotLook,
  APP_SKINS,
  appTheme,
} from "./floating-bot-window.mjs";
import { BUNBU_SKINS, LEGACY_BUNBU_SKINS, LEGACY_SHAPE_SKINS, LEGACY_TROMBI_SKINS, SHAPE_SKINS, TROMBI_SKINS } from "../shared/mascot-look.ts";
import { displaySignature } from "./retro-assistant-window.mjs";
import { SKIN_IDS } from "../src/lib/skins.ts";

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 850 } };
const SECOND = { id: 2, bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1040 } };

function fakeElectron({ displays = [PRIMARY] } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.destroyed = false;
      this.events = new Map();
      this.calls = [];
      const handlers = new Map();
      this.webContents = {
        sent: [],
        handlers,
        send: (channel, payload) => this.webContents.sent.push([channel, payload]),
        setWindowOpenHandler: vi.fn(),
        on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
        fire: (name, ...args) => (handlers.get(name) ?? []).forEach((fn) => fn(...args)),
      };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.events.get("closed")?.forEach((fn) => fn()); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; this.calls.push(["setBounds"]); }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; this.calls.push(["setPosition"]); }
    isFocused() { return this.calls.some(([name]) => name === "focus"); }
    setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
    setIgnoreMouseEvents(...args) { this.calls.push(["setIgnoreMouseEvents", ...args]); }
    setFocusable(...args) { this.calls.push(["setFocusable", ...args]); }
    focus() { this.calls.push(["focus"]); }
    showInactive() { this.calls.push(["showInactive"]); }
    on(name, fn) { this.events.set(name, [...(this.events.get(name) ?? []), fn]); }
    once(name, fn) { this.on(name, fn); }
  }
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
    removeListener: (channel) => listeners.delete(channel),
  };
  const screenEvents = new Map();
  const screen = {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getCursorScreenPoint: () => ({ x: 700, y: 400 }),
    on: (name, fn) => screenEvents.set(name, fn),
    removeListener: (name) => screenEvents.delete(name),
    setDisplays: (next) => { displays = next; },
    fire: (name) => screenEvents.get(name)?.(),
  };
  const main = { webContents: { sent: [], send(channel, payload) { this.sent.push([channel, payload]); } }, isDestroyed: () => false };
  return { BrowserWindow: FakeWindow, ipcMain, screen, handlers, listeners, windows, main };
}

function setup(extra = {}) {
  const fake = fakeElectron(extra);
  const saved = { positions: extra.positions };
  const focusMain = vi.fn();
  const controller = createFloatingBotWindows({
    BrowserWindow: fake.BrowserWindow,
    screen: fake.screen,
    ipcMain: fake.ipcMain,
    getMainWindow: () => fake.main,
    isTrustedMain: extra.isTrustedMain,
    platform: extra.platform ?? "darwin",
    pageUrl: () => `http://127.0.0.1:8799/?${FLOATING_QUERY}`,
    preload: "/app/electron/floating-bot-preload.cjs",
    readPositions: () => saved.positions ?? {},
    writePositions: (positions) => { saved.positions = JSON.parse(JSON.stringify(positions)); },
    focusMain,
    Menu: extra.Menu,
    log: (line) => logs.push(line),
  });
  const logs = [];
  const fromMain = { sender: fake.main.webContents };
  const invoke = (channel, event, ...args) => fake.handlers.get(channel)(event, ...args);
  const emit = (channel, event, ...args) => fake.listeners.get(channel)(event, ...args);
  const open = (botId, alwaysOnTop = true) => {
    invoke("floating-bots:open", fromMain, { botId, alwaysOnTop });
    const win = controller.window(botId);
    return { win, from: { sender: win.webContents } };
  };
  return { fake, controller, fromMain, invoke, emit, open, saved, focusMain, logs };
}

const SNAPSHOT = {
  v: 1,
  name: "Ada",
  label: "Ada, on the desktop",
  color: "green",
  skin: "none",
  avatar: null,
  pose: "speak",
  reduced: false,
  retro: false,
  sparkle: 2,
  locale: "fr",
  menu: [{ id: "open", label: "Ouvrir le fil" }, { id: "top", label: "Toujours au-dessus", checked: true }],
  balloon: { kind: "chat", text: "Bonjour", streaming: true, truncated: false, open: "Ouvrir dans Pulsa Bot", close: "Cacher la bulle", input: { label: "Message", placeholder: "Écrire", send: "Envoyer" } },
};

describe("floating bots: one window per bot", () => {
  it("opens a frameless, transparent, sandboxed, always-on-top window per bot on the main page's request", () => {
    const { fake, open } = setup();
    const { win } = open("bot_a");
    expect(win.options).toMatchObject({ frame: false, transparent: true, skipTaskbar: true, focusable: false, alwaysOnTop: true, show: false });
    expect(win.options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, preload: "/app/electron/floating-bot-preload.cjs" });
    // hidden or covered, the page is throttled: the 3D mascot stops drawing there
    expect(win.options.webPreferences.backgroundThrottling).toBe(true);
    expect(win.loadURL).toHaveBeenCalledWith(`http://127.0.0.1:8799/?${FLOATING_QUERY}`);
    expect(win.calls).toContainEqual(["setAlwaysOnTop", true, "floating"]);
    expect(win.calls).toContainEqual(["setIgnoreMouseEvents", true, { forward: true }]);
    open("bot_b");
    open("bot_a");
    expect(fake.windows).toHaveLength(2);
  });

  it("places a second bot beside the first, not on top of it", () => {
    const { open } = setup();
    const a = open("bot_a").win.getBounds();
    const b = open("bot_b").win.getBounds();
    expect(b.x).toBeLessThan(a.x);
  });

  it("caps the number of windows", () => {
    const { invoke, fromMain, fake } = setup();
    for (let i = 0; i < MAX_FLOATING + 3; i += 1) invoke("floating-bots:open", fromMain, { botId: `bot_${i}` });
    expect(fake.windows).toHaveLength(MAX_FLOATING);
  });

  it("toggles always on top per bot", () => {
    const { invoke, fromMain, open } = setup();
    const { win } = open("bot_a");
    expect(invoke("floating-bots:set-top", fromMain, { botId: "bot_a", on: false })).toBe(true);
    expect(win.calls.at(-1)).toEqual(["setAlwaysOnTop", false]);
    expect(invoke("floating-bots:set-top", fromMain, { botId: "bot_a", on: "yes" })).toBe(false);
    const { win: other } = open("bot_b", false);
    expect(other.calls).toContainEqual(["setAlwaysOnTop", false]);
  });
});

describe("floating bots: per-bot channels", () => {
  it("sends a bot's snapshot only to that bot's window, cleaned", () => {
    const { emit, open, fromMain } = setup();
    const a = open("bot_a").win;
    const b = open("bot_b").win;
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, token: "secret", balloon: { ...SNAPSHOT.balloon, html: "<b>" } } });
    expect(b.webContents.sent).toHaveLength(0);
    const [channel, state] = a.webContents.sent.at(-1);
    expect(channel).toBe("floating-bot:state");
    expect(state).not.toHaveProperty("token");
    expect(state.balloon).not.toHaveProperty("html");
  });

  it("tags an event with the window's own bot, whatever the payload claims", () => {
    const { emit, open, fake } = setup();
    open("bot_a");
    const { from } = open("bot_b");
    emit("floating-bots:event", from, { type: "send", text: "salut", botId: "bot_a" });
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:event", { botId: "bot_b", event: { type: "send", text: "salut" } }]);
  });

  it("lets only the local main page drive the windows", () => {
    const { invoke, emit, fake, open } = setup();
    expect(invoke("floating-bots:open", { sender: {} }, { botId: "bot_a" })).toBe(false);
    expect(fake.windows).toHaveLength(0);
    const { win, from } = open("bot_a");
    emit("floating-bots:update", from, { botId: "bot_a", snapshot: SNAPSHOT });
    expect(win.webContents.sent).toHaveLength(0);
    expect(invoke("floating-bots:close", from, { botId: "bot_a" })).toBe(false);
    expect(invoke("floating-bots:list", from)).toEqual([]);
    const remote = setup({ isTrustedMain: () => false });
    expect(remote.invoke("floating-bots:open", remote.fromMain, { botId: "bot_a" })).toBe(false);
  });

  it("lets only a floating window move, size or report, and only itself", () => {
    const { invoke, emit, open, fromMain, fake } = setup();
    const a = open("bot_a").win;
    const { win: b, from: fromB } = open("bot_b");
    const before = a.getBounds();
    expect(invoke("floating-bots:move-by", fromMain, { dx: -50, dy: -50 })).toBeNull();
    emit("floating-bots:event", fromMain, { type: "click" });
    expect(fake.main.webContents.sent.filter(([channel]) => channel === "floating-bots:event")).toHaveLength(0);
    invoke("floating-bots:move-by", fromB, { dx: -40, dy: -40 });
    expect(a.getBounds()).toEqual(before);
    expect(b.bounds.x).not.toBe(before.x);
  });

  it("refuses bad bot ids", () => {
    const { invoke, fromMain, fake } = setup();
    expect(invoke("floating-bots:open", fromMain, { botId: "../../x" })).toBe(false);
    expect(invoke("floating-bots:open", fromMain, "bot_a")).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  it("brings the app forward on Open in the app, and replays the last snapshot when ready", () => {
    const { emit, open, fromMain, focusMain } = setup();
    const { win, from } = open("bot_a");
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    win.webContents.sent.length = 0;
    emit("floating-bots:ready", from);
    expect(win.webContents.sent.at(-1)[1]).toMatchObject({ name: "Ada", pose: "speak" });
    emit("floating-bots:event", from, { type: "open" });
    emit("floating-bots:event", from, { type: "menu", id: "open" });
    expect(focusMain).toHaveBeenCalledTimes(2);
  });
});

describe("floating bots: lifecycle", () => {
  it("closes silently for the brain, tells it when closed from outside", () => {
    const { controller, invoke, fromMain, open, fake } = setup();
    open("bot_a");
    const { win: b } = open("bot_b");
    invoke("floating-bots:close", fromMain, { botId: "bot_a" });
    expect(controller.botIds).toEqual(["bot_b"]);
    expect(fake.main.webContents.sent.some(([channel]) => channel === "floating-bots:closed")).toBe(false);
    b.destroy();
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:closed", { botId: "bot_b" }]);
  });

  it("goes with the main window and on quit, without dropping the saved list", () => {
    const { controller, open, fake } = setup();
    const { win } = open("bot_a");
    controller.mainWindowGone();
    expect(win.destroyed).toBe(true);
    expect(fake.main.webContents.sent.some(([channel]) => channel === "floating-bots:closed")).toBe(false);
    open("bot_b");
    controller.dispose();
    expect(fake.handlers.size).toBe(0);
    expect(fake.listeners.size).toBe(0);
  });
});

describe("floating bots: a window is never left invisible", () => {
  it("retries a page that fails to load, reloads one that dies, and ignores an aborted load", () => {
    vi.useFakeTimers();
    try {
      const { open, logs } = setup();
      const { win } = open("bot_a");
      expect(win.loadURL).toHaveBeenCalledTimes(1);
      win.webContents.fire("did-fail-load", {}, -3, "ERR_ABORTED", "", true);
      vi.advanceTimersByTime(5000);
      expect(win.loadURL).toHaveBeenCalledTimes(1);
      win.webContents.fire("did-fail-load", {}, -2, "ERR_FAILED", "", true);
      vi.advanceTimersByTime(1000);
      expect(win.loadURL).toHaveBeenCalledTimes(2);
      win.webContents.fire("render-process-gone", {}, { reason: "crashed" });
      vi.advanceTimersByTime(2000);
      expect(win.loadURL).toHaveBeenCalledTimes(3);
      expect(logs.some((line) => line.includes("page failed to load"))).toBe(true);
      // never more than a few times
      for (let i = 0; i < 6; i += 1) win.webContents.fire("did-fail-load", {}, -2, "ERR_FAILED", "", true);
      vi.advanceTimersByTime(60_000);
      expect(win.loadURL.mock.calls.length).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a snapshot sent a moment before the window exists, for the window that opens", () => {
    const { emit, fromMain, open } = setup();
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    const { win, from } = open("bot_a");
    emit("floating-bots:ready", from);
    const [channel, state] = win.webContents.sent.at(-1);
    expect(channel).toBe("floating-bot:state");
    expect(state).toMatchObject({ name: "Ada", pose: "speak" });
  });

  it("asks the app page for a state when a window is ready without one, and keeps a closed window's state for the next", () => {
    const { emit, fromMain, open, invoke, fake } = setup();
    const first = open("bot_a");
    emit("floating-bots:ready", first.from);
    expect(fake.main.webContents.sent).toContainEqual(["floating-bots:want", { botId: "bot_a" }]);
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: SNAPSHOT });
    // closed and opened again (the app page remounted): the new window still gets the state
    invoke("floating-bots:close", fromMain, { botId: "bot_a" });
    const again = open("bot_a");
    emit("floating-bots:ready", again.from);
    expect(again.win.webContents.sent.at(-1)).toEqual(["floating-bot:state", expect.objectContaining({ name: "Ada" })]);
  });

  it("waits for a development page to answer before loading it", async () => {
    let calls = 0;
    const fetchImpl = async () => ({ ok: ++calls >= 3 });
    expect(await waitForPage("http://127.0.0.1:5199/", { fetchImpl, delayMs: 1 })).toBe(true);
    expect(calls).toBe(3);
    expect(await waitForPage("http://x/", { fetchImpl: async () => { throw new Error("down"); }, tries: 2, delayMs: 1 })).toBe(false);
  });

  it("says in its log why a state did not reach a window", () => {
    const { emit, open, logs, fake } = setup();
    emit("floating-bots:update", { sender: {} }, { botId: "bot_a", snapshot: SNAPSHOT });
    emit("floating-bots:update", { sender: fake.main.webContents }, { botId: "bot_a", snapshot: { v: 2 } });
    const { from } = open("bot_b");
    emit("floating-bots:ready", from);
    expect(logs).toEqual(expect.arrayContaining([
      "floating bots: update refused (not the app page)",
      "floating bots: state for bot_a refused as malformed",
      "floating bots: bot_b is ready but no state has come from the app yet; asking the app",
    ]));
  });

  it("reloads a page that never says it is ready, and logs the page's errors", () => {
    vi.useFakeTimers();
    try {
      const { open, emit, logs } = setup();
      const ready = open("bot_a");
      const silent = open("bot_b");
      emit("floating-bots:ready", ready.from);
      vi.advanceTimersByTime(READY_TIMEOUT_MS + 3000);
      expect(ready.win.loadURL).toHaveBeenCalledTimes(1);
      expect(silent.win.loadURL).toHaveBeenCalledTimes(2);
      silent.win.webContents.fire("console-message", { level: "error", message: "TypeError: boom" });
      silent.win.webContents.fire("console-message", { level: "info", message: "hello" });
      expect(logs.filter((line) => line.includes("page error"))).toEqual(["floating bot bot_b page error: TypeError: boom"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens to display changes only once the app is ready (the screen module needs it)", async () => {
    let ready;
    const whenReady = () => new Promise((resolve) => { ready = resolve; });
    const fake = fakeElectron();
    const on = vi.spyOn(fake.screen, "on");
    createFloatingBotWindows({ BrowserWindow: fake.BrowserWindow, screen: fake.screen, ipcMain: fake.ipcMain, getMainWindow: () => fake.main, pageUrl: () => "http://x/", preload: "/p", whenReady });
    expect(on).not.toHaveBeenCalled();
    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(on).toHaveBeenCalledWith("display-removed", expect.any(Function));
  });

  it("brings every mascot back on screen when a display goes away", () => {
    const { fake, open } = setup({ displays: [PRIMARY, SECOND] });
    const { win } = open("bot_a");
    win.setBounds({ x: 3000, y: 500, width: 156, height: 172 });
    fake.screen.setDisplays([PRIMARY]);
    fake.screen.fire("display-removed");
    const bounds = win.getBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
  });
});

describe("floating bots: positions and screens", () => {
  it("remembers each bot's spot per display setup and restores it clamped", () => {
    const first = setup();
    const { win, from } = first.open("bot_a");
    first.invoke("floating-bots:move-by", from, { dx: -300, dy: -200 });
    first.emit("floating-bots:moved", from);
    const spot = win.getBounds();
    const key = displaySignature([PRIMARY]);
    expect(first.saved.positions[key].bot_a).toEqual({ x: spot.x + spot.width, y: spot.y + spot.height });

    const again = setup({ positions: first.saved.positions });
    expect(again.open("bot_a").win.getBounds()).toMatchObject({ x: spot.x, y: spot.y });
  });

  it("lets the mascot fly its own window inside the work areas, without saving where it flew", () => {
    const { open, invoke, emit, saved, fake } = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = open("bot_a");
    const home = win.getBounds();
    const geometry = invoke("floating-bots:geometry", from);
    expect(geometry).toEqual({ bounds: home, workArea: PRIMARY.workArea, cursor: { x: 700, y: 400 } });
    emit("floating-bots:autopilot", from, true);
    // a flight cannot leave the screens
    expect(invoke("floating-bots:move-to", from, { x: -5000, y: 600 })).toMatchObject({ x: 0, y: 600 });
    expect(invoke("floating-bots:move-to", from, { x: 100, y: -900 })).toMatchObject({ x: 100, y: PRIMARY.workArea.y });
    win.events.get("moved")?.forEach((fn) => fn());
    emit("floating-bots:moved", from);
    expect(saved.positions).toBeUndefined();
    // flown onto the second display, it reports that display's work area
    invoke("floating-bots:move-to", from, { x: 2000, y: 500 });
    expect(invoke("floating-bots:geometry", from).workArea).toEqual(SECOND.workArea);
    emit("floating-bots:autopilot", from, false);
    emit("floating-bots:moved", from);
    expect(Object.values(saved.positions)[0].bot_a).toBeDefined();
    // the main page and a stranger cannot fly it
    expect(invoke("floating-bots:move-to", { sender: fake.main.webContents }, { x: 0, y: 0 })).toBeNull();
    expect(invoke("floating-bots:geometry", { sender: {} })).toBeNull();
    expect(invoke("floating-bots:move-to", from, { x: "1", y: 2 })).toBeNull();
  });

  it("pulls a spot saved off every screen back onto the visible displays", () => {
    const key = displaySignature([PRIMARY, SECOND]);
    const { open } = setup({ displays: [PRIMARY, SECOND], positions: { [key]: { bot_a: { x: 99999, y: -5000 } } } });
    const bounds = open("bot_a").win.getBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(SECOND.workArea.x + SECOND.workArea.width);
    expect(bounds.y).toBeGreaterThanOrEqual(SECOND.workArea.y);
  });

  it("grows a window from the mascot's corner: bottom-right, or the one the balloon opened away from", () => {
    const { open, invoke } = setup();
    const { win, from } = open("bot_a");
    win.setBounds({ x: 600, y: 300, width: 200, height: 200 });
    expect(invoke("floating-bots:resize", from, { width: 500, height: 400 })).toMatchObject({ x: 300, y: 100 });
    win.setBounds({ x: 600, y: 300, width: 200, height: 200 });
    expect(invoke("floating-bots:resize", from, { width: 500, height: 400, anchorX: "left", anchorY: "top" })).toMatchObject({ x: 600, y: 300 });
  });

  it("drags and resizes inside the work areas", () => {
    const { invoke, open } = setup();
    const { win, from } = open("bot_a");
    invoke("floating-bots:move-by", from, { dx: -1e9, dy: -1e9 });
    expect(win.bounds).toMatchObject({ x: PRIMARY.workArea.x, y: PRIMARY.workArea.y });
    expect(invoke("floating-bots:move-by", from, { dx: Number.NaN, dy: 0 })).toBeNull();
    invoke("floating-bots:resize", from, { width: 99999, height: 99999 });
    expect(win.bounds.width).toBeLessThanOrEqual(FLOAT_MAX.width);
    expect(win.bounds.height).toBeLessThanOrEqual(Math.min(FLOAT_MAX.height, PRIMARY.workArea.height));
  });

  it("drops malformed saved positions", () => {
    expect(sanitizePositions({ sig: { bot_a: { x: 1, y: 2 }, "bad id": { x: 1, y: 1 }, bot_b: { x: "1", y: 2 } } })).toEqual({ sig: { bot_a: { x: 1, y: 2 } } });
    expect(sanitizePositions(null)).toEqual({});
    expect(sanitizePositions([1, 2])).toEqual({});
  });

  it("steps new bots across the bottom of the primary display", () => {
    const a = floatingDefaultBounds(PRIMARY.workArea, 0);
    const b = floatingDefaultBounds(PRIMARY.workArea, 1);
    expect(b.x).toBeLessThan(a.x);
    expect(a.y + a.height).toBeLessThanOrEqual(PRIMARY.workArea.y + PRIMARY.workArea.height);
  });
});

describe("floating bots: payload validation", () => {
  it("refuses a snapshot of the wrong shape", () => {
    expect(sanitizeFloatingSnapshot(null)).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, v: 2 })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, pose: "dance" })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, name: 5 })).toBeNull();
  });

  it("bounds every text and list, and keeps only safe values", () => {
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      locale: "fr<script>",
      color: "red; background:url(x)",
      skin: "../../x",
      sparkle: -1,
      menu: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: "x".repeat(500) })),
      balloon: { ...SNAPSHOT.balloon, kind: "chat", text: "y".repeat(9000), asked: "z".repeat(900) },
    });
    expect(clean).toMatchObject({ locale: "en", color: "blue", skin: "none", sparkle: 0 });
    expect(clean.menu).toHaveLength(8);
    expect(clean.menu[0].label.length).toBe(80);
    expect(clean.balloon.text.length).toBe(4000);
    expect(clean.balloon.asked.length).toBe(300);
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, balloon: { kind: "html" } }).balloon).toBeNull();
  });

  it("keeps the mascot's task, mood, fly-away choice and hints, bounded", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ task: "idle", mood: 0.6, flyAway: true, hints: { mood: "", working: "" } });
    const clean = sanitizeFloatingSnapshot({ ...SNAPSHOT, task: "working", mood: 4, flyAway: false, hints: { mood: "m".repeat(500), working: "w".repeat(500), html: "<b>" } });
    expect(clean).toMatchObject({ task: "working", mood: 1, flyAway: false });
    expect(clean.hints.mood.length).toBe(80);
    expect(clean.hints.working.length).toBe(200);
    expect(clean.hints).not.toHaveProperty("html");
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, task: "rm -rf", mood: Number.NaN })).toMatchObject({ task: "idle", mood: 0.6 });
  });

  it("keeps the character a bot wears and its look, known values only", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ mascot: { character: "owl" } });
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      mascot: { character: "shape", shape: "cloud", style: "3d", skins: { shape: "neon", trombi: "gold", html: "<b>" }, extra: 1 },
    });
    expect(clean.mascot).toEqual({ character: "shape", shape: "cloud", style: "3d", skins: { shape: "neon", trombi: "gold" } });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, mascot: { character: "dragon" } }).mascot).toEqual({ character: "owl" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, mascot: { character: "shape", shape: "rocket" } }).mascot).toEqual({ character: "shape" });
  });

  it("keeps the bot's id, a few earlier exchanges and the pin label, bounded", () => {
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      id: "bot_a",
      hints: { pin: "Put back" },
      balloon: { ...SNAPSHOT.balloon, history: [...Array.from({ length: 9 }, (_, i) => ({ asked: `q${i}`, text: "t".repeat(3000) })), null] },
    });
    expect(clean.id).toBe("bot_a");
    expect(clean.hints.pin).toBe("Put back");
    expect(clean.balloon.history).toHaveLength(3);
    expect(clean.balloon.history[0].text.length).toBe(2000);
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, id: "../x" }).id).toBe("");
  });

  it("keeps the activity level, the hoot and the context figures for the energy bar, bounded", () => {
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).toMatchObject({ liveliness: "normal", context: null });
    const clean = sanitizeFloatingSnapshot({
      ...SNAPSHOT,
      liveliness: "lively",
      hints: { hoot: "h".repeat(90) },
      context: { percent: 24.4, tokens: 48_000, window: 200_000, detail: "d".repeat(400), label: "Context 24%", html: "<b>" },
    });
    expect(clean.liveliness).toBe("lively");
    expect(clean.hints.hoot.length).toBe(40);
    expect(clean.context).toEqual({ percent: 24, tokens: 48_000, window: 200_000, detail: "d".repeat(120), label: "Context 24%" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, liveliness: "wild", context: { tokens: "x" } })).toMatchObject({ liveliness: "normal", context: null });
  });

  it("takes a picture only as a bounded inline image, never a URL", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, avatar: { src: png, crop: "rounded", zoom: 9 } }).avatar).toEqual({ src: png, crop: "rounded", zoom: 3, focusX: 0.5, focusY: 0.5 });
    for (const src of ["/api/attachments/a.png", "https://evil/x.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", `data:image/png;base64,${"A".repeat(AVATAR_MAX)}`]) {
      expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, avatar: { src } }).avatar).toBeNull();
    }
  });

  it("accepts only the events a floating window can make", () => {
    expect(sanitizeFloatingEvent({ type: "click" })).toEqual({ type: "click" });
    expect(sanitizeFloatingEvent({ type: "play", extra: 1 })).toEqual({ type: "play" });
    expect(sanitizeFloatingEvent({ type: "pet" })).toEqual({ type: "pet" });
    expect(sanitizeFloatingEvent({ type: "mascot", choice: { character: "trombi" } })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "menu", id: "dock" })).toEqual({ type: "menu", id: "dock" });
    expect(sanitizeFloatingEvent({ type: "menu", id: "../x" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: "q".repeat(5000) }).text.length).toBe(4000);
    expect(sanitizeFloatingEvent({ type: "send", text: "   " })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: 1 })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "eval", code: "x" })).toBeNull();
    expect(sanitizeFloatingEvent("click")).toBeNull();
  });
});

describe("floating bots: a voice call with the mascot", () => {
  it("passes the call's states, short texts and settings only, bounded", () => {
    const call = sanitizeCall({
      phase: "speaking", muted: true, botAudible: true, push: false, startedAt: 5, line: "x".repeat(5000), token: "secret",
      transcript: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, who: i % 2 ? "bot" : "you", text: "hi", html: "<b>" })),
      settings: { voice: "eve", speed: 9, language: "fr", key: "sk" },
      callSettings: { input: "push", onlyMyVoice: true, earcons: false, pause: "patient" },
      voices: [{ id: "eve", label: "Eve" }, { id: "bad id!", label: "X" }],
      enrollment: { state: "recording", share: 3 },
      previewing: { id: "eve", loading: true },
    });
    expect(call).not.toHaveProperty("token");
    expect(call.line).toHaveLength(1200);
    expect(call.transcript).toHaveLength(8);
    expect(call.transcript[0]).not.toHaveProperty("html");
    expect(call.settings).toEqual({ voice: "eve", speed: 2, language: "fr" });
    expect(call.callSettings).toEqual({ input: "push", onlyMyVoice: true, earcons: false, pause: "patient" });
    expect(call.voices).toEqual([{ id: "eve", label: "Eve" }]);
    expect(call.enrollment).toEqual({ state: "recording", share: 1 });
    expect(sanitizeCall({ phase: "ringing" })).toBeNull();
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, call: { phase: "listening" }, hints: { call: "Call Sagax" } })).toMatchObject({ call: { phase: "listening" }, hints: { call: "Call Sagax" } });
  });

  it("takes back only known call actions, with checked settings", () => {
    expect(sanitizeFloatingEvent({ type: "call", action: "start", botId: "other" })).toEqual({ type: "call", action: "start" });
    expect(sanitizeFloatingEvent({ type: "call", action: "dial" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "call", action: "preview", voice: "eve" })).toEqual({ type: "call", action: "preview", voice: "eve" });
    expect(sanitizeFloatingEvent({ type: "call", action: "settings", patch: { voice: "eve", speed: 1.5, xai: "key" } })).toEqual({ type: "call", action: "settings", patch: { voice: "eve", speed: 1.5 } });
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { input: "shout" } })).toBeNull();
    // the end-of-turn pause (Short / Normal / Patient) travels too
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { pause: "short" } })).toMatchObject({ patch: { pause: "short" } });
    expect(sanitizeFloatingEvent({ type: "call", action: "call-settings", patch: { pause: "forever" } })).toBeNull();
  });

  it("relays the call's levels from the app page to that bot's window only", () => {
    const { emit, open, fromMain } = setup();
    const a = open("bot_a");
    const b = open("bot_b").win;
    emit("floating-bots:level", fromMain, { botId: "bot_a", levels: { bot: 2, mic: 0.2 } });
    expect(a.win.webContents.sent.at(-1)).toEqual(["floating-bot:level", { bot: 1, mic: 0.2 }]);
    expect(b.webContents.sent).toHaveLength(0);
    // a mascot window cannot speak for the app page
    emit("floating-bots:level", a.from, { botId: "bot_b", levels: { bot: 1, mic: 1 } });
    expect(b.webContents.sent).toHaveLength(0);
  });
});

describe("floating bots: the menu opens at the pointer", () => {
  const areas = [PRIMARY.workArea, SECOND.workArea];
  it("puts it exactly where the click was, in the window's coordinates", () => {
    expect(menuPopupPoint({ x: 120, y: 80 }, 1, { x: 600, y: 400, width: 240, height: 260 }, areas)).toEqual({ x: 120, y: 80 });
    // a zoomed page reports CSS pixels: times the zoom gives the window's (DIP) coordinates
    expect(menuPopupPoint({ x: 100, y: 50 }, 1.25, { x: 600, y: 400, width: 300, height: 300 }, areas)).toEqual({ x: 125, y: 63 });
    // on the second display (left of it at x 1440)
    expect(menuPopupPoint({ x: 30, y: 40 }, 1, { x: 2000, y: 500, width: 240, height: 260 }, areas)).toEqual({ x: 30, y: 40 });
  });

  it("keeps it inside the work area of the display under the click", () => {
    // a window partly above the primary's menu bar (work area starts at y 25)
    expect(menuPopupPoint({ x: 50, y: 5 }, 1, { x: 100, y: 0, width: 240, height: 260 }, areas)).toEqual({ x: 50, y: 25 });
    // off the bottom of the primary (work area ends at 875): back inside
    expect(menuPopupPoint({ x: 10, y: 250 }, 1, { x: 100, y: 700, width: 240, height: 260 }, areas)).toEqual({ x: 10, y: 174 });
    // past the right edge of the second display: the nearest area's last pixel
    expect(menuPopupPoint({ x: 300, y: 10 }, 1, { x: 3300, y: 100, width: 240, height: 260 }, areas)).toEqual({ x: 59, y: 10 });
  });

  it("pops main's native menu over the asking window only, with the snapshot's items", () => {
    const popup = vi.fn();
    let template = null;
    const Menu = { buildFromTemplate: vi.fn((items) => { template = items; return { popup }; }) };
    const { emit, open, fromMain, fake } = setup({ Menu });
    const a = open("bot_a");
    emit("floating-bots:update", fromMain, { botId: "bot_a", snapshot: { ...SNAPSHOT, menu: [{ id: "call", label: "Appeler" }, { id: "top", label: "Always on top", checked: true }] } });
    a.win.setBounds?.({ x: 600, y: 400, width: 240, height: 260 });
    emit("floating-bots:menu", a.from, { x: 33, y: 44 });
    expect(popup).toHaveBeenCalledOnce();
    const [options] = popup.mock.calls[0];
    expect(options.window).toBe(a.win);
    expect(template.map((item) => item.label)).toEqual(["Appeler", "Always on top"]);
    expect(template[1]).toMatchObject({ type: "checkbox", checked: true });
    template[0].click();
    expect(fake.main.webContents.sent.at(-1)).toEqual(["floating-bots:event", { botId: "bot_a", event: { type: "menu", id: "call" } }]);
    // the app page cannot pop a mascot's menu
    emit("floating-bots:menu", fromMain, { x: 1, y: 1 });
    expect(popup).toHaveBeenCalledOnce();
  });
});

describe("the desktop window's mascot look", () => {
  it("knows every shape and Trombi skin, and maps older names like the app", () => {
    for (const skin of SHAPE_SKINS) expect(mascotLook({ character: "shape", skins: { shape: skin } }).skins.shape).toBe(skin);
    for (const skin of TROMBI_SKINS) expect(mascotLook({ character: "trombi", skins: { trombi: skin } }).skins.trombi).toBe(skin);
    for (const [old, current] of Object.entries(LEGACY_SHAPE_SKINS)) expect(mascotLook({ character: "shape", skins: { shape: old } }).skins.shape).toBe(current);
    for (const [old, current] of Object.entries(LEGACY_TROMBI_SKINS)) expect(mascotLook({ character: "trombi", skins: { trombi: old } }).skins.trombi).toBe(current);
    expect(mascotLook({ character: "shape", skins: { shape: "plasma" } })).toEqual({ character: "shape" });
  });

  it("knows Bunbu and its twelve skins, legacy names included, and drops a skin it does not know", () => {
    for (const skin of BUNBU_SKINS) expect(mascotLook({ character: "bunbu", skins: { bunbu: skin } })).toEqual({ character: "bunbu", skins: { bunbu: skin } });
    for (const [old, current] of Object.entries(LEGACY_BUNBU_SKINS)) expect(mascotLook({ character: "bunbu", skins: { bunbu: old } }).skins.bunbu).toBe(current);
    expect(mascotLook({ character: "bunbu", skins: { bunbu: "junk" } })).toEqual({ character: "bunbu" });
  });
});

describe("floating bots: a smooth chat", () => {
  it("saves a dragged spot once the window stands still, not at every step macOS reports", () => {
    vi.useFakeTimers();
    try {
      const { open, invoke, saved } = setup();
      const { win, from } = open("bot_a");
      for (let i = 0; i < 30; i += 1) {
        invoke("floating-bots:move-by", from, { dx: -3, dy: -2 });
        win.events.get("moved")?.forEach((fn) => fn());
      }
      expect(saved.positions).toBeUndefined();
      vi.advanceTimersByTime(REMEMBER_DELAY_MS);
      const spot = win.getBounds();
      expect(Object.values(saved.positions)[0].bot_a).toEqual({ x: spot.x + spot.width, y: spot.y + spot.height });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never saves the steps of the mascot's own flight, even when it lands before the delay", () => {
    vi.useFakeTimers();
    try {
      const { open, emit, invoke, saved } = setup();
      const { win, from } = open("bot_a");
      emit("floating-bots:autopilot", from, true);
      invoke("floating-bots:move-to", from, { x: 100, y: 300 });
      win.events.get("moved")?.forEach((fn) => fn());
      emit("floating-bots:autopilot", from, false);
      vi.advanceTimersByTime(REMEMBER_DELAY_MS * 2);
      expect(saved.positions).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a window without resizing it, and asks nothing when nothing changes", () => {
    const { open, invoke } = setup();
    const { win, from } = open("bot_a");
    win.calls.length = 0;
    invoke("floating-bots:move-by", from, { dx: -10, dy: -10 });
    expect(win.calls.map(([name]) => name)).toEqual(["setPosition"]);
    const { width, height } = win.getBounds();
    win.calls.length = 0;
    invoke("floating-bots:resize", from, { width, height });
    expect(win.calls).toEqual([]);
    invoke("floating-bots:resize", from, { width: width + 100, height: height + 100 });
    expect(win.calls.map(([name]) => name)).toEqual(["setBounds"]);
  });

  it("lets clicks through or takes them only on a change, and focuses only a window without the focus", () => {
    const { open, emit } = setup();
    const { win, from } = open("bot_a");
    win.calls.length = 0;
    for (const on of [true, true, true, false, false, true]) emit("floating-bots:set-interactive", from, on);
    expect(win.calls.filter(([name]) => name === "setIgnoreMouseEvents").map(([, ignore]) => ignore)).toEqual([false, true, false]);
    for (const on of [true, true, true]) emit("floating-bots:set-focusable", from, on);
    expect(win.calls.filter(([name]) => name === "setFocusable")).toEqual([["setFocusable", true]]);
    expect(win.calls.filter(([name]) => name === "focus")).toHaveLength(1);
    emit("floating-bots:set-focusable", from, false);
    expect(win.calls.filter(([name]) => name === "setFocusable").at(-1)).toEqual(["setFocusable", false]);
  });

  it("passes the app's theme to the window: a known skin and a hex accent only", () => {
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "pulsatrix-light", accent: "#336699" } }).theme).toEqual({ skin: "pulsatrix-light", accent: "#336699" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "pulsatrix-light", accent: "javascript:x" } }).theme).toEqual({ skin: "pulsatrix-light" });
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, theme: { skin: "other" } })).not.toHaveProperty("theme");
    expect(sanitizeFloatingSnapshot(SNAPSHOT)).not.toHaveProperty("theme");
    expect(appTheme({ skin: "dusk", accent: "#abcdef", extra: 1 })).toEqual({ skin: "dusk", accent: "#abcdef" });
    // main's list is the app's list
    expect([...APP_SKINS].sort()).toEqual([...SKIN_IDS].sort());
  });
});
