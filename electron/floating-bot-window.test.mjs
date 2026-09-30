import { describe, expect, it, vi } from "vitest";

import {
  AVATAR_MAX,
  createFloatingBotWindows,
  FLOATING_QUERY,
  floatingDefaultBounds,
  MAX_FLOATING,
  sanitizeFloatingEvent,
  sanitizeFloatingSnapshot,
  sanitizePositions,
} from "./floating-bot-window.mjs";
import { displaySignature } from "./retro-assistant-window.mjs";

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
      this.webContents = { sent: [], send: (channel, payload) => this.webContents.sent.push([channel, payload]), setWindowOpenHandler: vi.fn(), on: vi.fn() };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.events.get("closed")?.forEach((fn) => fn()); }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
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
  const screen = { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0] };
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
  });
  const fromMain = { sender: fake.main.webContents };
  const invoke = (channel, event, ...args) => fake.handlers.get(channel)(event, ...args);
  const emit = (channel, event, ...args) => fake.listeners.get(channel)(event, ...args);
  const open = (botId, alwaysOnTop = true) => {
    invoke("floating-bots:open", fromMain, { botId, alwaysOnTop });
    const win = controller.window(botId);
    return { win, from: { sender: win.webContents } };
  };
  return { fake, controller, fromMain, invoke, emit, open, saved, focusMain };
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

  it("pulls a spot saved off every screen back onto the visible displays", () => {
    const key = displaySignature([PRIMARY, SECOND]);
    const { open } = setup({ displays: [PRIMARY, SECOND], positions: { [key]: { bot_a: { x: 99999, y: -5000 } } } });
    const bounds = open("bot_a").win.getBounds();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(SECOND.workArea.x + SECOND.workArea.width);
    expect(bounds.y).toBeGreaterThanOrEqual(SECOND.workArea.y);
  });

  it("drags and resizes inside the work areas", () => {
    const { invoke, open } = setup();
    const { win, from } = open("bot_a");
    invoke("floating-bots:move-by", from, { dx: -1e9, dy: -1e9 });
    expect(win.bounds).toMatchObject({ x: PRIMARY.workArea.x, y: PRIMARY.workArea.y });
    expect(invoke("floating-bots:move-by", from, { dx: Number.NaN, dy: 0 })).toBeNull();
    invoke("floating-bots:resize", from, { width: 99999, height: 99999 });
    expect(win.bounds.width).toBeLessThanOrEqual(400);
    expect(win.bounds.height).toBeLessThanOrEqual(560);
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
    expect(clean.menu).toHaveLength(6);
    expect(clean.menu[0].label.length).toBe(80);
    expect(clean.balloon.text.length).toBe(4000);
    expect(clean.balloon.asked.length).toBe(300);
    expect(sanitizeFloatingSnapshot({ ...SNAPSHOT, balloon: { kind: "html" } }).balloon).toBeNull();
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
    expect(sanitizeFloatingEvent({ type: "menu", id: "dock" })).toEqual({ type: "menu", id: "dock" });
    expect(sanitizeFloatingEvent({ type: "menu", id: "../x" })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: "q".repeat(5000) }).text.length).toBe(4000);
    expect(sanitizeFloatingEvent({ type: "send", text: "   " })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "send", text: 1 })).toBeNull();
    expect(sanitizeFloatingEvent({ type: "eval", code: "x" })).toBeNull();
    expect(sanitizeFloatingEvent("click")).toBeNull();
  });
});
