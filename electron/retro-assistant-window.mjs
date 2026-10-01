/**
 * Hibou 98: the assistant "detached from the window". While the retro mode is
 * on and the person chose "Detach from the window", Trombi (or the owl, or
 * their own pictures) stands in a small frameless, transparent, always-on-top
 * window of its own and can be dragged anywhere on the screen.
 *
 * The main app window stays the brain: its renderer decides the pose, the
 * balloon and the tips, and sends a plain snapshot here; this window only
 * draws it and reports clicks back. So this module is a relay with a window:
 *
 *   main renderer  --retro-assistant:update-->  main  --state-->  assistant window
 *   assistant window  --retro-assistant:event-->  main  --event-->  main renderer
 *
 * Every payload is validated and every channel checks its sender: only the
 * main window may drive the window, only the assistant window may move it or
 * report a click. The window loads the app bundle's assistant-only page with
 * contextIsolation, a sandbox, no Node, and its own tiny preload.
 */

export const DETACHED_QUERY = "omb-retro-assistant=1";

/**
 * Transparent, frameless, above other apps, out of the taskbar, never stealing
 * focus. Shared with the floating bots (electron/floating-bot-window.mjs).
 */
export function assistantWindowOptions({ preload, bounds, title = "Trombi", session }) {
  return {
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    title,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
      // server mode with no local server: the page comes from this app's
      // bundle in a session of its own (electron/bundled-ui.cjs)
      ...(session ? { session } : {}),
    },
  };
}

export const DEFAULT_SIZE = Object.freeze({ width: 150, height: 190 });
export const MIN_SIZE = Object.freeze({ width: 60, height: 60 });
export const MAX_SIZE = Object.freeze({ width: 420, height: 560 });
const MAX_MOVE = 4000;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clampNumber = (value, low, high) => Math.min(Math.max(value, low), high);

/** A stable key for "this arrangement of screens", so each setup keeps its own spot. */
export function displaySignature(displays) {
  return displays
    .map((display) => {
      const b = display.bounds ?? display.workArea;
      return `${b.x},${b.y},${b.width}x${b.height}`;
    })
    .sort()
    .join("|");
}

/**
 * Keeps a window of this size fully inside one display's work area: the one
 * it overlaps most, else the nearest. It can never end up off every screen.
 */
export function clampToDisplays(bounds, workAreas) {
  if (!workAreas.length) return { ...bounds };
  const overlap = (area) => {
    const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const distance = (area) => {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const dx = Math.max(area.x - cx, 0, cx - (area.x + area.width));
    const dy = Math.max(area.y - cy, 0, cy - (area.y + area.height));
    return dx * dx + dy * dy;
  };
  let best = workAreas[0];
  let bestOverlap = overlap(best);
  for (const area of workAreas.slice(1)) {
    const value = overlap(area);
    if (value > bestOverlap || (bestOverlap === 0 && value === 0 && distance(area) < distance(best))) {
      best = area;
      bestOverlap = value;
    }
  }
  const width = Math.min(bounds.width, best.width);
  const height = Math.min(bounds.height, best.height);
  return {
    x: Math.round(clampNumber(bounds.x, best.x, best.x + best.width - width)),
    y: Math.round(clampNumber(bounds.y, best.y, best.y + best.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** The first spot: bottom right of the primary display, clear of the edge. */
export function defaultBounds(primaryWorkArea, size = DEFAULT_SIZE) {
  return {
    x: primaryWorkArea.x + primaryWorkArea.width - size.width - 24,
    y: primaryWorkArea.y + primaryWorkArea.height - size.height - 24,
    width: size.width,
    height: size.height,
  };
}

/* ---------------------------------------------------------------- payloads */

const TEXT_MAX = 600;
const ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const POSES = new Set(["idle", "speak", "think", "bored", "sleep", "celebrate", "send"]);
const CHARACTERS = new Set(["trombi", "owl", "custom"]);

const text = (value, max = TEXT_MAX) => (typeof value === "string" ? value.slice(0, max) : undefined);

function items(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, limit)
    .filter((item) => item && typeof item === "object" && ID_RE.test(item.id) && typeof item.label === "string")
    .map((item) => ({ id: item.id, label: item.label.slice(0, 160), ...(item.default === true ? { default: true } : {}) }));
}

/**
 * What the brain may tell the window: a pose and, when talking, a balloon of
 * short texts and choices. Anything else is dropped; a malformed snapshot is
 * refused outright (null).
 */
export function sanitizeSnapshot(value) {
  if (!value || typeof value !== "object" || value.v !== 1) return null;
  if (!CHARACTERS.has(value.character) || !POSES.has(value.pose)) return null;
  const snapshot = {
    v: 1,
    character: value.character,
    pose: value.pose,
    reduced: value.reduced === true,
    locale: /^[a-zA-Z-]{2,16}$/.test(value.locale ?? "") ? value.locale : "en",
    label: text(value.label, 160) ?? "",
    bulb: text(value.bulb, 160) ?? null,
    look: value.look && typeof value.look === "object"
      ? { color: text(value.look.color, 24) ?? "blue", skin: text(value.look.skin, 24) ?? "none" }
      : null,
    menu: items(value.menu, 8),
    balloon: null,
  };
  const balloon = value.balloon;
  if (balloon && typeof balloon === "object") {
    snapshot.balloon = {
      title: text(balloon.title, 160),
      text: text(balloon.text),
      question: text(balloon.question, 300),
      bullets: items(balloon.bullets, 6),
      buttons: items(balloon.buttons, 4),
      ask: balloon.ask && typeof balloon.ask === "object"
        ? {
            label: text(balloon.ask.label, 160) ?? "",
            placeholder: text(balloon.ask.placeholder, 160) ?? "",
            search: text(balloon.ask.search, 60) ?? "",
            options: text(balloon.ask.options, 60) ?? "",
          }
        : undefined,
    };
  }
  return snapshot;
}

const EVENT_TYPES = new Set(["click", "bulb", "bullet", "button", "menu", "search", "options", "dismiss", "context"]);

/** What the window may report back: a click on something it was shown. */
export function sanitizeEvent(value) {
  if (!value || typeof value !== "object" || !EVENT_TYPES.has(value.type)) return null;
  if (value.type === "bullet" || value.type === "button" || value.type === "menu") {
    return ID_RE.test(value.id ?? "") ? { type: value.type, id: value.id } : null;
  }
  if (value.type === "search") {
    return typeof value.query === "string" ? { type: "search", query: value.query.slice(0, 200) } : null;
  }
  return { type: value.type };
}

/* -------------------------------------------------------------- controller */

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {{ getAllDisplays(): any[]; getPrimaryDisplay(): any }} deps.screen
 * @param {{ handle: Function; on: Function; removeHandler?: Function; removeListener?: Function }} deps.ipcMain
 * @param {() => (import("electron").BrowserWindow | null)} deps.getMainWindow
 * @param {() => string} deps.pageUrl       the app origin's assistant-only page
 * @param {string} deps.preload             path to retro-assistant-preload.cjs
 * @param {() => Record<string, {x:number,y:number}>} [deps.readPositions]
 * @param {(positions: Record<string, {x:number,y:number}>) => void} [deps.writePositions]
 * @param {(event: any) => boolean} [deps.isTrustedMain]  the sender is the local app page
 * @param {string} [deps.platform]          process.platform by default
 * @param {(line: string) => void} [deps.log]
 */
export function createRetroAssistantWindow(deps) {
  const { BrowserWindow, screen, ipcMain, getMainWindow, pageUrl, preload } = deps;
  // Linux cannot forward pointer moves through an ignoring window, so there
  // the small window simply stays clickable rather than becoming unreachable.
  const clickThrough = (deps.platform ?? process.platform) !== "linux";
  const log = deps.log ?? (() => {});
  let win = null;
  let snapshot = null;
  let positions = null;
  const savedPositions = () => {
    if (positions) return positions;
    try {
      const read = deps.readPositions?.();
      positions = read && typeof read === "object" ? read : {};
    } catch {
      positions = {};
    }
    return positions;
  };

  const workAreas = () => screen.getAllDisplays().map((display) => display.workArea);
  const signature = () => displaySignature(screen.getAllDisplays());
  const isAssistant = (event) => Boolean(win && !win.isDestroyed() && event?.sender === win.webContents);
  const isMain = (event) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event?.sender !== main.webContents) return false;
    // a remote server's page in the main window never drives this window
    return deps.isTrustedMain ? deps.isTrustedMain(event) : true;
  };

  const notifyMain = (channel, payload) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(channel, payload);
  };

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    const { x, y, width, height } = win.getBounds();
    // store the bottom-right corner: the character stands there whatever the balloon does
    const all = savedPositions();
    all[signature()] = { x: x + width, y: y + height };
    try {
      deps.writePositions?.(all);
    } catch {
      /* the spot is only a convenience */
    }
  };

  const startBounds = () => {
    const saved = savedPositions()[signature()];
    const primary = screen.getPrimaryDisplay().workArea;
    const bounds = saved && isFiniteNumber(saved.x) && isFiniteNumber(saved.y)
      ? { x: saved.x - DEFAULT_SIZE.width, y: saved.y - DEFAULT_SIZE.height, ...DEFAULT_SIZE }
      : defaultBounds(primary);
    return clampToDisplays(bounds, workAreas());
  };

  function open() {
    if (win && !win.isDestroyed()) return win;
    const created = new BrowserWindow(assistantWindowOptions({ preload, bounds: startBounds(), session: deps.session?.() ?? undefined }));
    win = created;
    try {
      created.setAlwaysOnTop(true, "floating");
      created.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
      // transparent pixels let clicks through until the pointer is over the art
      if (clickThrough) created.setIgnoreMouseEvents(true, { forward: true });
    } catch {
      /* platform without one of these: the window still works */
    }
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.once("ready-to-show", () => {
      if (!created.isDestroyed()) created.showInactive();
    });
    created.on("moved", remember);
    created.once("closed", () => {
      if (win === created) win = null;
      notifyMain("retro-assistant:detached-changed", false);
    });
    void created.loadURL(pageUrl()).catch((error) => log(`retro assistant window failed to load: ${error?.message ?? error}`));
    return created;
  }

  function close() {
    const current = win;
    win = null;
    if (current && !current.isDestroyed()) current.destroy();
  }

  /* ---------------------------------------------------------------- IPC */

  const handlers = {
    "retro-assistant:set-detached": (event, on) => {
      if (!isMain(event)) return false;
      if (on === true) open();
      else close();
      return Boolean(win);
    },
    "retro-assistant:move-by": (event, delta) => {
      if (!isAssistant(event) || !delta || !isFiniteNumber(delta.dx) || !isFiniteNumber(delta.dy)) return null;
      const bounds = win.getBounds();
      const next = clampToDisplays(
        { ...bounds, x: bounds.x + clampNumber(delta.dx, -MAX_MOVE, MAX_MOVE), y: bounds.y + clampNumber(delta.dy, -MAX_MOVE, MAX_MOVE) },
        workAreas(),
      );
      win.setBounds(next);
      return { x: next.x, y: next.y };
    },
    "retro-assistant:resize": (event, size) => {
      if (!isAssistant(event) || !size || !isFiniteNumber(size.width) || !isFiniteNumber(size.height)) return null;
      const bounds = win.getBounds();
      const width = Math.round(clampNumber(size.width, MIN_SIZE.width, MAX_SIZE.width));
      const height = Math.round(clampNumber(size.height, MIN_SIZE.height, MAX_SIZE.height));
      // grow up and to the left: the character's feet stay where they were
      const next = clampToDisplays({ x: bounds.x + bounds.width - width, y: bounds.y + bounds.height - height, width, height }, workAreas());
      win.setBounds(next);
      return next;
    },
    "retro-assistant:get-position": (event) => {
      if (!isAssistant(event)) return null;
      const { x, y } = win.getBounds();
      return { x, y };
    },
  };

  const listeners = {
    "retro-assistant:update": (event, value) => {
      if (!isMain(event)) return;
      const clean = sanitizeSnapshot(value);
      if (!clean) return;
      snapshot = clean;
      if (win && !win.isDestroyed()) win.webContents.send("retro-assistant:state", snapshot);
    },
    "retro-assistant:ready": (event) => {
      if (isAssistant(event) && snapshot) win.webContents.send("retro-assistant:state", snapshot);
    },
    "retro-assistant:event": (event, value) => {
      if (!isAssistant(event)) return;
      const clean = sanitizeEvent(value);
      if (clean) notifyMain("retro-assistant:event", clean);
    },
    "retro-assistant:set-interactive": (event, on) => {
      if (!isAssistant(event) || typeof on !== "boolean" || !clickThrough) return;
      try {
        win.setIgnoreMouseEvents(!on, { forward: true });
      } catch {
        /* keep the last state */
      }
    },
    "retro-assistant:set-focusable": (event, on) => {
      if (!isAssistant(event) || typeof on !== "boolean") return;
      try {
        win.setFocusable(on);
        if (on) win.focus();
      } catch {
        /* keep the last state */
      }
    },
    "retro-assistant:moved": (event) => {
      if (isAssistant(event)) remember();
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(listeners)) ipcMain.on(channel, handler);

  return {
    /** For tests and for main's lifecycle hooks. */
    get window() {
      return win && !win.isDestroyed() ? win : null;
    },
    open,
    close,
    /** The main window is gone (closed or crashed): its brain went with it. */
    mainWindowGone: close,
    dispose() {
      close();
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel);
      for (const [channel, handler] of Object.entries(listeners)) ipcMain.removeListener?.(channel, handler);
    },
  };
}
