import { describe, expect, it, vi } from "vitest";

import {
  assistantWindowOptions,
  clampToDisplays,
  createRetroAssistantWindow,
  DETACHED_QUERY,
  displaySignature,
  sanitizeEvent,
  sanitizeSnapshot,
} from "./retro-assistant-window.mjs";

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
      this.webContents = {
        sent: [],
        send: (channel, payload) => this.webContents.sent.push([channel, payload]),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
      };
      this.loadURL = vi.fn(async () => undefined);
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() {
      this.destroyed = true;
      this.events.get("closed")?.forEach((fn) => fn());
    }
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
  const saved = {};
  const controller = createRetroAssistantWindow({
    BrowserWindow: fake.BrowserWindow,
    screen: fake.screen,
    ipcMain: fake.ipcMain,
    getMainWindow: () => fake.main,
    isTrustedMain: extra.isTrustedMain,
    platform: extra.platform ?? "darwin",
    pageUrl: () => `http://127.0.0.1:8799/?${DETACHED_QUERY}`,
    preload: "/app/electron/retro-assistant-preload.cjs",
    readPositions: () => saved.positions ?? {},
    writePositions: (positions) => { saved.positions = JSON.parse(JSON.stringify(positions)); },
  });
  const fromMain = { sender: fake.main.webContents };
  const invoke = (channel, event, ...args) => fake.handlers.get(channel)(event, ...args);
  const emit = (channel, event, ...args) => fake.listeners.get(channel)(event, ...args);
  const open = () => {
    invoke("retro-assistant:set-detached", fromMain, true);
    const win = fake.windows.at(-1);
    return { win, fromAssistant: { sender: win.webContents } };
  };
  return { fake, controller, fromMain, invoke, emit, open, saved };
}

const SNAPSHOT = {
  v: 1,
  character: "trombi",
  pose: "speak",
  reduced: false,
  locale: "fr",
  label: "Trombi",
  bulb: null,
  look: null,
  menu: [{ id: "attach", label: "Rattacher à la fenêtre" }],
  balloon: { question: "Bonjour !", bullets: [{ id: "tip", label: "Une astuce" }], buttons: [], ask: { label: "Que voulez-vous faire ?", placeholder: "", search: "Chercher", options: "Options" } },
};

describe("retro assistant window: creation", () => {
  it("is frameless, transparent, always on top, out of the taskbar and never takes focus", () => {
    const options = assistantWindowOptions({ preload: "/p.cjs", bounds: { x: 1, y: 2, width: 150, height: 190 } });
    expect(options).toMatchObject({
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      x: 1,
      y: 2,
    });
    expect(options.webPreferences).toMatchObject({ preload: "/p.cjs", contextIsolation: true, sandbox: true, nodeIntegration: false });
  });

  it("opens only when the main page asks, floats on every workspace and lets clicks through", () => {
    const { fake, open } = setup();
    expect(fake.windows).toHaveLength(0);
    const { win } = open();
    expect(win.options.webPreferences.sandbox).toBe(true);
    expect(win.loadURL).toHaveBeenCalledWith(`http://127.0.0.1:8799/?${DETACHED_QUERY}`);
    expect(win.calls).toContainEqual(["setAlwaysOnTop", true, "floating"]);
    expect(win.calls).toContainEqual(["setVisibleOnAllWorkspaces", true, { visibleOnFullScreen: true }]);
    expect(win.calls).toContainEqual(["setIgnoreMouseEvents", true, { forward: true }]);
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
  });

  it("starts at the bottom right of the primary display's work area", () => {
    const { open } = setup();
    const { win } = open();
    expect(win.bounds.x + win.bounds.width).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
    expect(win.bounds.y + win.bounds.height).toBeLessThanOrEqual(PRIMARY.workArea.y + PRIMARY.workArea.height);
    expect(win.bounds.x).toBeGreaterThan(PRIMARY.workArea.width / 2);
  });

  it("opens once however often it is asked", () => {
    const { fake, invoke, fromMain } = setup();
    invoke("retro-assistant:set-detached", fromMain, true);
    invoke("retro-assistant:set-detached", fromMain, true);
    expect(fake.windows).toHaveLength(1);
  });
});

describe("retro assistant window: lifecycle", () => {
  it("is destroyed when the mode (or the detach option) is turned off", () => {
    const { controller, invoke, fromMain, open, fake } = setup();
    const { win } = open();
    expect(invoke("retro-assistant:set-detached", fromMain, false)).toBe(false);
    expect(win.destroyed).toBe(true);
    expect(controller.window).toBeNull();
    // the main page hears the window went away
    expect(fake.main.webContents.sent).toContainEqual(["retro-assistant:detached-changed", false]);
  });

  it("goes with the main window, whose page is its brain", () => {
    const { controller, open } = setup();
    const { win } = open();
    controller.mainWindowGone();
    expect(win.destroyed).toBe(true);
  });

  it("closes on quit and drops its IPC handlers on dispose", () => {
    const { controller, open, fake } = setup();
    const { win } = open();
    controller.dispose();
    expect(win.destroyed).toBe(true);
    expect(fake.handlers.size).toBe(0);
    expect(fake.listeners.size).toBe(0);
  });
});

describe("retro assistant window: IPC senders", () => {
  it("lets only the main window open it", () => {
    const { fake, invoke } = setup();
    expect(invoke("retro-assistant:set-detached", { sender: {} }, true)).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  it("refuses a remote server's page in the main window", () => {
    const { fake, invoke, fromMain } = setup({ isTrustedMain: () => false });
    expect(invoke("retro-assistant:set-detached", fromMain, true)).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  it("lets only the assistant window move, resize or report a click", () => {
    const { invoke, emit, open, fromMain, fake } = setup();
    const { win } = open();
    const before = win.getBounds();
    expect(invoke("retro-assistant:move-by", fromMain, { dx: -50, dy: -50 })).toBeNull();
    expect(invoke("retro-assistant:resize", fromMain, { width: 300, height: 400 })).toBeNull();
    emit("retro-assistant:event", fromMain, { type: "click" });
    expect(win.getBounds()).toEqual(before);
    expect(fake.main.webContents.sent.filter(([channel]) => channel === "retro-assistant:event")).toHaveLength(0);
  });

  it("relays a clean snapshot to the window and clean events to the main page", () => {
    const { emit, open, fromMain, fake } = setup();
    const { win, fromAssistant } = open();
    emit("retro-assistant:update", fromMain, { ...SNAPSHOT, extra: "dropped", balloon: { ...SNAPSHOT.balloon, html: "<b>x</b>" } });
    const [channel, state] = win.webContents.sent.at(-1);
    expect(channel).toBe("retro-assistant:state");
    expect(state).not.toHaveProperty("extra");
    expect(state.balloon).not.toHaveProperty("html");
    emit("retro-assistant:event", fromAssistant, { type: "bullet", id: "tip", evil: true });
    expect(fake.main.webContents.sent).toContainEqual(["retro-assistant:event", { type: "bullet", id: "tip" }]);
  });

  it("replays the last snapshot when the window's page is ready", () => {
    const { emit, open, fromMain } = setup();
    emit("retro-assistant:update", fromMain, SNAPSHOT);
    const { win, fromAssistant } = open();
    emit("retro-assistant:ready", fromAssistant);
    expect(win.webContents.sent.at(-1)[1]).toMatchObject({ pose: "speak", locale: "fr" });
  });

  it("toggles click-through and focus only for booleans from its own page", () => {
    const { emit, open, fromMain } = setup();
    const { win, fromAssistant } = open();
    emit("retro-assistant:set-interactive", fromAssistant, true);
    expect(win.calls.at(-1)).toEqual(["setIgnoreMouseEvents", false, { forward: true }]);
    emit("retro-assistant:set-interactive", fromAssistant, "yes");
    emit("retro-assistant:set-interactive", fromMain, false);
    expect(win.calls.at(-1)).toEqual(["setIgnoreMouseEvents", false, { forward: true }]);
    emit("retro-assistant:set-focusable", fromAssistant, true);
    expect(win.calls.slice(-2)).toEqual([["setFocusable", true], ["focus"]]);
  });
});

describe("retro assistant window: Linux", () => {
  it("stays clickable where pointer moves cannot be forwarded", () => {
    const { open, emit } = setup({ platform: "linux" });
    const { win, fromAssistant } = open();
    expect(win.calls.some(([name]) => name === "setIgnoreMouseEvents")).toBe(false);
    emit("retro-assistant:set-interactive", fromAssistant, false);
    expect(win.calls.some(([name]) => name === "setIgnoreMouseEvents")).toBe(false);
  });
});

describe("retro assistant window: staying on screen", () => {
  it("drags by a delta but never leaves the displays' work areas", () => {
    const { invoke, open } = setup();
    const { win, fromAssistant } = open();
    invoke("retro-assistant:move-by", fromAssistant, { dx: -100000, dy: -100000 });
    expect(win.bounds.x).toBe(PRIMARY.workArea.x);
    expect(win.bounds.y).toBe(PRIMARY.workArea.y);
    invoke("retro-assistant:move-by", fromAssistant, { dx: 1e9, dy: 1e9 });
    expect(win.bounds.x + win.bounds.width).toBeLessThanOrEqual(PRIMARY.workArea.x + PRIMARY.workArea.width);
    expect(invoke("retro-assistant:move-by", fromAssistant, { dx: Number.NaN, dy: 1 })).toBeNull();
    expect(invoke("retro-assistant:move-by", fromAssistant, "left")).toBeNull();
  });

  it("can cross onto a second display", () => {
    const { invoke, open } = setup({ displays: [PRIMARY, SECOND] });
    const { win, fromAssistant } = open();
    invoke("retro-assistant:move-by", fromAssistant, { dx: 800, dy: 0 });
    expect(win.bounds.x).toBeGreaterThanOrEqual(SECOND.workArea.x);
  });

  it("grows up and to the left for the balloon, keeping its feet in place", () => {
    const { invoke, open } = setup();
    const { win, fromAssistant } = open();
    const before = win.getBounds();
    invoke("retro-assistant:resize", fromAssistant, { width: 300, height: 400 });
    expect(win.bounds.x + win.bounds.width).toBe(before.x + before.width);
    expect(win.bounds.y + win.bounds.height).toBe(before.y + before.height);
    invoke("retro-assistant:resize", fromAssistant, { width: 99999, height: 99999 });
    expect(win.bounds.width).toBeLessThanOrEqual(420);
  });

  it("remembers its spot per display setup", () => {
    const first = setup();
    const { win, fromAssistant } = first.open();
    first.invoke("retro-assistant:move-by", fromAssistant, { dx: -300, dy: -200 });
    first.emit("retro-assistant:moved", fromAssistant);
    const spot = win.getBounds();
    const key = displaySignature([PRIMARY]);
    expect(first.saved.positions[key]).toEqual({ x: spot.x + spot.width, y: spot.y + spot.height });
  });

  it("clamps to the display it overlaps most, else the nearest", () => {
    const areas = [PRIMARY.workArea, SECOND.workArea];
    expect(clampToDisplays({ x: 5000, y: 5000, width: 150, height: 190 }, areas)).toEqual({ x: 3360 - 150, y: 1040 - 190, width: 150, height: 190 });
    expect(clampToDisplays({ x: -900, y: 300, width: 150, height: 190 }, areas)).toMatchObject({ x: 0 });
    expect(clampToDisplays({ x: 10, y: 10, width: 100, height: 100 }, [])).toEqual({ x: 10, y: 10, width: 100, height: 100 });
  });

  it("keys a display setup the same whatever the order", () => {
    expect(displaySignature([PRIMARY, SECOND])).toBe(displaySignature([SECOND, PRIMARY]));
    expect(displaySignature([PRIMARY])).not.toBe(displaySignature([PRIMARY, SECOND]));
  });
});

describe("retro assistant window: payload validation", () => {
  it("refuses a snapshot of the wrong shape", () => {
    expect(sanitizeSnapshot(null)).toBeNull();
    expect(sanitizeSnapshot({ ...SNAPSHOT, v: 2 })).toBeNull();
    expect(sanitizeSnapshot({ ...SNAPSHOT, character: "clippy" })).toBeNull();
    expect(sanitizeSnapshot({ ...SNAPSHOT, pose: "dance" })).toBeNull();
  });

  it("bounds every text and list", () => {
    const clean = sanitizeSnapshot({
      ...SNAPSHOT,
      locale: "fr<script>",
      menu: Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, label: "x".repeat(500) })),
      balloon: { ...SNAPSHOT.balloon, text: "y".repeat(5000), bullets: [{ id: "bad id!", label: "x" }, { id: "ok", label: "fine" }] },
    });
    expect(clean.locale).toBe("en");
    expect(clean.menu).toHaveLength(8);
    expect(clean.menu[0].label.length).toBe(160);
    expect(clean.balloon.text.length).toBe(600);
    expect(clean.balloon.bullets).toEqual([{ id: "ok", label: "fine" }]);
  });

  it("accepts only the clicks the window can make", () => {
    expect(sanitizeEvent({ type: "click" })).toEqual({ type: "click" });
    expect(sanitizeEvent({ type: "menu", id: "attach" })).toEqual({ type: "menu", id: "attach" });
    expect(sanitizeEvent({ type: "menu", id: "../../etc" })).toBeNull();
    expect(sanitizeEvent({ type: "search", query: "q".repeat(500) })).toEqual({ type: "search", query: "q".repeat(200) });
    expect(sanitizeEvent({ type: "search", query: 42 })).toBeNull();
    expect(sanitizeEvent({ type: "eval", code: "x" })).toBeNull();
    expect(sanitizeEvent("click")).toBeNull();
  });
});
