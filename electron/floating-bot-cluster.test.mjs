// The floating cluster (the character and the pill hanging on it) on screen:
// never under the macOS Dock or the Windows taskbar, wherever they sit, on
// any display, kept on drag end, on a display change and on show; positions
// kept per display setup and per display (floating-bot-positions.json).
import { describe, expect, it, vi } from "vitest";

import {
  clampClusterToDisplays,
  clusterBox,
  createFloatingBotWindows,
  displayKeyAt,
  FLOAT_BODY,
  FLOAT_HOME,
  FLOATING_QUERY,
  sanitizePositions,
  savedSpotFor,
} from "./floating-bot-window.mjs";
import { displaySignature } from "./retro-assistant-window.mjs";

// a 1440x900 MacBook: menu bar 25 px; the Dock at the bottom (70 px), on the left or on the right
const FRAME = { x: 0, y: 0, width: 1440, height: 900 };
const DOCK_BOTTOM = { ...FRAME, y: 25, height: 805 };
const DOCK_LEFT = { x: 70, y: 25, width: 1370, height: 875 };
const DOCK_RIGHT = { x: 0, y: 25, width: 1370, height: 875 };
// the Dock hidden automatically: the work area is the frame under the menu bar (4 px kept for the Dock's trigger)
const DOCK_HIDDEN = { x: 0, y: 25, width: 1440, height: 871 };
// a Windows taskbar, 48 px, at the bottom of a 1920x1080 display
const TASKBAR = { x: 0, y: 0, width: 1920, height: 1032 };

const PRIMARY = { id: 1, bounds: FRAME, workArea: DOCK_BOTTOM };
const SECOND = { id: 2, bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1040 } };

// the home window: the character's box, and the input pill under its feet (FloatingBotView: stage top + 120 + 2)
const BODY = FLOAT_BODY;
const PILL_BELOW = { x: BODY.x - 40, y: BODY.y + BODY.height + 2, width: 200, height: 36 };
const PILL_ABOVE = { x: BODY.x - 40, y: BODY.y - 38, width: 200, height: 36 };
const WINDOW = { width: FLOAT_HOME.width, height: FLOAT_HOME.height };
const at = (x, y) => ({ x, y, ...WINDOW });
/** The cluster's box on the screen for a window spot. */
const onScreen = (bounds, keep) => {
  const box = clusterBox(BODY, keep);
  return { left: bounds.x + box.x, top: bounds.y + box.y, right: bounds.x + box.x + box.width, bottom: bounds.y + box.y + box.height };
};
const inside = (box, area) => box.left >= area.x && box.top >= area.y && box.right <= area.x + area.width && box.bottom <= area.y + area.height;

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
  const logs = [];
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


describe("the floating cluster stays in the work area", () => {
  it("grows the kept box by the pill, above or below the character", () => {
    expect(clusterBox(BODY, null)).toEqual(BODY);
    expect(clusterBox(BODY, PILL_BELOW)).toEqual({ x: BODY.x - 40, y: BODY.y, width: 200, height: BODY.height + 38 });
    expect(clusterBox(BODY, PILL_ABOVE)).toEqual({ x: BODY.x - 40, y: BODY.y - 38, width: 200, height: BODY.height + 38 });
  });

  it("never lets the pill go under a Dock at the bottom: the cluster rises above it", () => {
    // dropped right on the Dock
    const placed = clampClusterToDisplays(at(1000, 900 - BODY.y - BODY.height), BODY, PILL_BELOW, [DOCK_BOTTOM]);
    const box = onScreen(placed, PILL_BELOW);
    expect(inside(box, DOCK_BOTTOM)).toBe(true);
    expect(box.bottom).toBe(DOCK_BOTTOM.y + DOCK_BOTTOM.height);
    // the character alone could have stood lower: the pill is what lifts it
    const alone = onScreen(clampClusterToDisplays(at(1000, 900), BODY, null, [DOCK_BOTTOM]), null);
    expect(alone.bottom).toBe(830);
  });

  it("keeps the cluster off a Dock on the left or on the right", () => {
    const left = onScreen(clampClusterToDisplays(at(-500, 300), BODY, PILL_BELOW, [DOCK_LEFT]), PILL_BELOW);
    expect(left.left).toBe(DOCK_LEFT.x);
    expect(inside(left, DOCK_LEFT)).toBe(true);
    const right = onScreen(clampClusterToDisplays(at(3000, 300), BODY, PILL_BELOW, [DOCK_RIGHT]), PILL_BELOW);
    expect(right.right).toBe(DOCK_RIGHT.x + DOCK_RIGHT.width);
    expect(inside(right, DOCK_RIGHT)).toBe(true);
  });

  it("with the Dock hidden automatically, uses the whole frame under the menu bar", () => {
    const box = onScreen(clampClusterToDisplays(at(600, 2000), BODY, PILL_BELOW, [DOCK_HIDDEN]), PILL_BELOW);
    expect(box.bottom).toBe(DOCK_HIDDEN.y + DOCK_HIDDEN.height);
    const top = onScreen(clampClusterToDisplays(at(600, -2000), BODY, PILL_ABOVE, [DOCK_HIDDEN]), PILL_ABOVE);
    expect(top.top).toBe(25);
  });

  it("keeps it above a Windows taskbar the same way", () => {
    const box = onScreen(clampClusterToDisplays(at(1500, 1100), BODY, PILL_BELOW, [TASKBAR]), PILL_BELOW);
    expect(box.bottom).toBe(TASKBAR.height);
    expect(inside(box, TASKBAR)).toBe(true);
  });

  it("on several displays, keeps it on the one it stands on, else the nearest", () => {
    const areas = [DOCK_BOTTOM, SECOND.workArea];
    // on the second display's bottom edge: that display's own work area
    const second = onScreen(clampClusterToDisplays(at(2000, 1200), BODY, PILL_BELOW, areas), PILL_BELOW);
    expect(inside(second, SECOND.workArea)).toBe(true);
    expect(second.bottom).toBe(1040);
    // on the laptop, over its Dock: the laptop's work area, not the taller neighbour's
    const laptop = onScreen(clampClusterToDisplays(at(800, 900 - BODY.y - BODY.height), BODY, PILL_BELOW, areas), PILL_BELOW);
    expect(inside(laptop, DOCK_BOTTOM)).toBe(true);
    // off every screen: the nearest display
    expect(inside(onScreen(clampClusterToDisplays(at(-3000, 5000), BODY, PILL_BELOW, areas), PILL_BELOW), DOCK_BOTTOM)).toBe(true);
  });
});

describe("the floating cluster in the window controller", () => {
  it("brings the cluster back above the Dock when the pill opens past it, and keeps it there on drag end", () => {
    const { open, emit, invoke } = setup();
    const { win, from } = open("bot_a");
    // dragged right down onto the Dock: only the character is known, it stands on the Dock's edge
    invoke("floating-bots:move-to", from, { x: 900, y: 2000 });
    expect(onScreen(win.getBounds(), null).bottom).toBe(830);
    // the page reports the pill under its feet: the whole cluster goes back above the Dock
    emit("floating-bots:body", from, { ...BODY, keep: PILL_BELOW });
    expect(onScreen(win.getBounds(), PILL_BELOW).bottom).toBe(830);
    // a drag that ends with the cluster past the edge is pulled back in
    win.setPosition(win.getBounds().x, win.getBounds().y + 60);
    emit("floating-bots:moved", from);
    expect(inside(onScreen(win.getBounds(), PILL_BELOW), DOCK_BOTTOM)).toBe(true);
    // every step of a drag keeps it in too
    invoke("floating-bots:move-by", from, { dx: 0, dy: 500 });
    expect(inside(onScreen(win.getBounds(), PILL_BELOW), DOCK_BOTTOM)).toBe(true);
  });

  it("a pill over the head near the Dock moves nothing; one that closes stops counting", () => {
    const { open, emit, invoke } = setup();
    const { win, from } = open("bot_a");
    invoke("floating-bots:move-to", from, { x: 900, y: 2000 });
    const before = win.getBounds();
    emit("floating-bots:body", from, { ...BODY, keep: PILL_ABOVE });
    expect(win.getBounds()).toEqual(before);
    emit("floating-bots:body", from, { ...BODY, keep: null });
    invoke("floating-bots:move-to", from, { x: 900, y: 2000 });
    expect(onScreen(win.getBounds(), null).bottom).toBe(830);
  });

  it("puts the cluster back in when the Dock grows or a display goes (display-metrics-changed, display-removed)", () => {
    const { open, emit, invoke, fake } = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = open("bot_a");
    // standing on the laptop's Dock (the taller second display is nearer to a spot far below)
    invoke("floating-bots:move-to", from, { x: 400, y: 830 - BODY.y - BODY.height });
    emit("floating-bots:body", from, { ...BODY, keep: PILL_BELOW });
    expect(onScreen(win.getBounds(), PILL_BELOW).bottom).toBe(830);
    // the Dock grows to 120 px
    const bigDock = { ...DOCK_BOTTOM, height: 755 };
    fake.screen.setDisplays([{ ...PRIMARY, workArea: bigDock }, SECOND]);
    fake.screen.fire("display-metrics-changed");
    expect(onScreen(win.getBounds(), PILL_BELOW).bottom).toBe(bigDock.y + bigDock.height);
    // moved onto the second display, which then goes away
    invoke("floating-bots:move-to", from, { x: 2400, y: 2000 });
    expect(inside(onScreen(win.getBounds(), PILL_BELOW), SECOND.workArea)).toBe(true);
    fake.screen.setDisplays([{ ...PRIMARY, workArea: bigDock }]);
    fake.screen.fire("display-removed");
    expect(inside(onScreen(win.getBounds(), PILL_BELOW), bigDock)).toBe(true);
  });

  it("on show, a spot saved under the Dock comes back inside the work area", () => {
    const key = displaySignature([PRIMARY]);
    const { open } = setup({ positions: { [key]: { bot_a: { x: 1200, y: 899, v: 2 } } } });
    expect(onScreen(open("bot_a").win.getBounds(), null).bottom).toBe(830);
  });
});

describe("positions per display", () => {
  it("names the display a point is on by its frame", () => {
    expect(displayKeyAt({ x: 10, y: 10 }, [PRIMARY, SECOND])).toBe("display:0,0,1440x900");
    expect(displayKeyAt({ x: 2000, y: 10 }, [PRIMARY, SECOND])).toBe("display:1440,0,1920x1080");
    expect(displayKeyAt({ x: -10, y: 10 }, [PRIMARY, SECOND])).toBeNull();
  });

  it("saves the spot for the setup and for the display, and an older file still reads", () => {
    const first = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = first.open("bot_a");
    first.invoke("floating-bots:move-to", from, { x: 2000, y: 200 });
    first.emit("floating-bots:moved", from);
    const spot = win.getBounds();
    const corner = { x: spot.x + BODY.x + BODY.width, y: spot.y + BODY.y + BODY.height, v: 2 };
    // the setup's entry keeps its old shape (an older build reads it as before)
    expect(first.saved.positions[displaySignature([PRIMARY, SECOND])].bot_a).toEqual(corner);
    expect(first.saved.positions["display:1440,0,1920x1080"].bot_a).toMatchObject(corner);
    expect(first.saved.positions["display:1440,0,1920x1080"].bot_a.t).toBeGreaterThan(0);
    // an older file (no display entries, no t) sanitizes unchanged
    const old = { [displaySignature([PRIMARY])]: { bot_a: { x: 900, y: 800 }, bot_b: { x: 10, y: 10, v: 2 } } };
    expect(sanitizePositions(old)).toEqual(old);
  });

  it("brings a bot back to its spot on a display that is still there when the setup changed", () => {
    const first = setup({ displays: [PRIMARY, SECOND] });
    const { win, from } = first.open("bot_a");
    first.invoke("floating-bots:move-to", from, { x: 300, y: 100 });
    first.emit("floating-bots:moved", from);
    const spot = win.getBounds();
    // the second display unplugged: a setup never seen, but the laptop is the same display
    const again = setup({ displays: [PRIMARY], positions: first.saved.positions });
    expect(again.open("bot_a").win.getBounds()).toMatchObject({ x: spot.x, y: spot.y });
  });

  it("prefers the exact setup, then the latest display spot", () => {
    const positions = {
      [displaySignature([PRIMARY])]: { bot_a: { x: 500, y: 500, v: 2 } },
      "display:0,0,1440x900": { bot_a: { x: 700, y: 700, v: 2, t: 2 } },
      "display:1440,0,1920x1080": { bot_a: { x: 2000, y: 700, v: 2, t: 5 } },
    };
    expect(savedSpotFor(positions, "bot_a", [PRIMARY])).toEqual({ x: 500, y: 500, v: 2 });
    expect(savedSpotFor(positions, "bot_a", [PRIMARY, SECOND])).toEqual({ x: 2000, y: 700, v: 2, t: 5 });
    expect(savedSpotFor(positions, "bot_b", [PRIMARY, SECOND])).toBeNull();
  });
});
