/**
 * Floating bots: any bot can be put "on the desktop" from its right-click menu.
 * It then stands in a small frameless, transparent, always-on-top window of
 * its own, like Trombi detached from the window (retro-assistant-window.mjs,
 * whose window options and screen clamping this module reuses), and can be
 * dragged anywhere on the screen. Several bots can float at once: one window
 * per bot.
 *
 * The main app window stays the brain. Its renderer holds the session, calls
 * the API, streams the reply and decides the pose and the balloon; it sends a
 * plain snapshot per bot here. A floating window only draws its snapshot and
 * reports clicks and typed text back. It never sees a token, a cookie value or
 * an API route: nothing but plain text and a picture as a data: URL.
 *
 *   main renderer  --floating-bots:update {botId, snapshot}-->  main  --floating-bot:state-->  that bot's window
 *   a bot's window  --floating-bots:event {event}-->  main  --floating-bots:event {botId, event}-->  main renderer
 *
 * The per-bot channel is the window itself: main knows which webContents is
 * which bot's window, so a window can only speak for its own bot (whatever id
 * it might claim) and a snapshot for a bot only ever reaches that bot's
 * window. Every payload is validated and every channel checks its sender: only
 * the local main page drives the windows, only a floating window may move,
 * size or report for itself. The windows load the app bundle's floating-only
 * page with contextIsolation, a sandbox, no Node, and their own tiny preload.
 */
import { assistantWindowOptions, clampToDisplays, displaySignature } from "./retro-assistant-window.mjs";

export const FLOATING_QUERY = "omb-floating-bot=1";

export const FLOAT_SIZE = Object.freeze({ width: 156, height: 172 });
export const FLOAT_MIN = Object.freeze({ width: 60, height: 60 });
export const FLOAT_MAX = Object.freeze({ width: 400, height: 560 });
/** More than this many floating windows is a mistake, not a desk. */
export const MAX_FLOATING = 12;
const MAX_MOVE = 4000;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const clampNumber = (value, low, high) => Math.min(Math.max(value, low), high);

/** Bot ids as the server mints them; anything else never names a window. */
export const BOT_ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
export const isBotId = (value) => typeof value === "string" && BOT_ID_RE.test(value);

/**
 * Where a new floating bot first lands: along the bottom of the primary
 * display, right to left, so a second and third bot do not stack on the first.
 */
export function floatingDefaultBounds(primaryWorkArea, index = 0, size = FLOAT_SIZE) {
  const step = size.width + 8;
  const perRow = Math.max(1, Math.floor((primaryWorkArea.width - 48) / step));
  const column = index % perRow;
  const row = Math.floor(index / perRow) % 4;
  return {
    x: primaryWorkArea.x + primaryWorkArea.width - size.width - 24 - column * step,
    y: primaryWorkArea.y + primaryWorkArea.height - size.height - 24 - row * (size.height + 8),
    width: size.width,
    height: size.height,
  };
}

/* ---------------------------------------------------------------- payloads */

export const REPLY_MAX = 4000;
const ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const POSES = new Set(["idle", "think", "speak", "celebrate", "alert", "sleep"]);
const BALLOON_KINDS = new Set(["chat", "thinking", "approval", "error"]);
const TASKS = new Set(["idle", "working", "waiting", "error"]);
const LIVELINESS = new Set(["calm", "normal", "lively"]);
const MAX_TOKENS = 1e9;
const MASCOT_KINDS = new Set(["owl", "body", "trombi"]);
const BODY_RE = /^[a-z]{1,24}$/;

/** Which character a bot wears: a known kind, a body shape id, a style. */
export function mascotChoice(value) {
  if (!value || typeof value !== "object" || !MASCOT_KINDS.has(value.kind)) return null;
  return {
    kind: value.kind,
    ...(typeof value.body === "string" && BODY_RE.test(value.body) ? { body: value.body } : {}),
    ...(value.style === "2d" || value.style === "3d" ? { style: value.style } : {}),
  };
}

/** The balloon's tabs and the Mascot tab's texts: short strings only. */
function picker(value) {
  if (!value || typeof value !== "object") return null;
  const kinds = {};
  for (const kind of MASCOT_KINDS) kinds[kind] = text(value.kinds?.[kind], 40) ?? kind;
  const bodies = {};
  if (value.bodies && typeof value.bodies === "object") {
    for (const [id, name] of Object.entries(value.bodies).slice(0, 24)) if (BODY_RE.test(id) && typeof name === "string") bodies[id] = name.slice(0, 40);
  }
  return {
    tabs: text(value.tabs, 60) ?? "",
    chat: text(value.chat, 40) ?? "",
    mascot: text(value.mascot, 40) ?? "",
    kinds,
    shape: text(value.shape, 40) ?? "",
    style: text(value.style, 40) ?? "",
    flat: text(value.flat, 40) ?? "",
    threeD: text(value.threeD, 40) ?? "",
    bodies,
  };
}

/** The followed thread's context use, for the mascot's energy bar: numbers and two short texts. */
function context(value) {
  if (!value || typeof value !== "object" || !isFiniteNumber(value.tokens) || value.tokens < 0) return null;
  return {
    ...(isFiniteNumber(value.percent) ? { percent: clampNumber(Math.round(value.percent), 0, 999) } : {}),
    tokens: clampNumber(Math.round(value.tokens), 0, MAX_TOKENS),
    ...(isFiniteNumber(value.window) && value.window > 0 ? { window: clampNumber(Math.round(value.window), 1, MAX_TOKENS) } : {}),
    detail: text(value.detail, 120) ?? "",
    label: text(value.label, 60) ?? "",
  };
}
const CROPS = new Set(["circle", "rounded", "square"]);
const COLOR_RE = /^#?[a-zA-Z0-9-]{1,24}$/;
const SKIN_RE = /^[a-z0-9-]{1,32}$/;
/** Only a picture, inline, of a bounded size: no URL the window could fetch. */
const AVATAR_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const AVATAR_MAX = 400_000;

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : undefined);
const flag = (value) => value === true;

function menuItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .filter((item) => item && typeof item === "object" && ID_RE.test(item.id) && typeof item.label === "string")
    .map((item) => ({
      id: item.id,
      label: item.label.slice(0, 80),
      ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
    }));
}

function avatar(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.src !== "string" || value.src.length > AVATAR_MAX || !AVATAR_RE.test(value.src)) return null;
  return {
    src: value.src,
    crop: CROPS.has(value.crop) ? value.crop : "circle",
    zoom: isFiniteNumber(value.zoom) ? clampNumber(value.zoom, 1, 3) : 1,
    focusX: isFiniteNumber(value.focusX) ? clampNumber(value.focusX, 0, 1) : 0.5,
    focusY: isFiniteNumber(value.focusY) ? clampNumber(value.focusY, 0, 1) : 0.5,
  };
}

/**
 * What the brain may tell a floating bot's window: who it is, how it looks, a
 * pose and, when talking, a balloon of short plain texts. Anything else is
 * dropped; a malformed snapshot is refused outright (null).
 */
export function sanitizeFloatingSnapshot(value) {
  if (!value || typeof value !== "object" || value.v !== 1) return null;
  if (!POSES.has(value.pose) || typeof value.name !== "string") return null;
  const snapshot = {
    v: 1,
    name: value.name.slice(0, 80),
    label: text(value.label, 200) ?? value.name.slice(0, 80),
    color: typeof value.color === "string" && COLOR_RE.test(value.color) ? value.color : "blue",
    skin: typeof value.skin === "string" && SKIN_RE.test(value.skin) ? value.skin : "none",
    avatar: avatar(value.avatar),
    pose: value.pose,
    reduced: flag(value.reduced),
    retro: flag(value.retro),
    sparkle: Number.isSafeInteger(value.sparkle) && value.sparkle >= 0 ? value.sparkle : 0,
    locale: /^[a-zA-Z-]{2,16}$/.test(value.locale ?? "") ? value.locale : "en",
    menu: menuItems(value.menu),
    balloon: null,
    // the mascot: what its bot is doing, its mood, and whether it flies off meanwhile
    task: TASKS.has(value.task) ? value.task : "idle",
    mood: isFiniteNumber(value.mood) ? clampNumber(value.mood, 0, 1) : 0.6,
    flyAway: value.flyAway !== false,
    hints: {
      mood: text(value.hints?.mood, 80) ?? "",
      working: text(value.hints?.working, 200) ?? "",
      ...(typeof value.hints?.hoot === "string" ? { hoot: value.hints.hoot.slice(0, 40) } : {}),
    },
    liveliness: LIVELINESS.has(value.liveliness) ? value.liveliness : "normal",
    context: context(value.context),
    mascot: mascotChoice(value.mascot) ?? { kind: "owl", style: "2d" },
    picker: picker(value.picker),
  };
  const balloon = value.balloon;
  if (balloon && typeof balloon === "object" && BALLOON_KINDS.has(balloon.kind)) {
    snapshot.balloon = {
      kind: balloon.kind,
      title: text(balloon.title, 160),
      asked: text(balloon.asked, 300),
      text: text(balloon.text, REPLY_MAX) ?? "",
      streaming: flag(balloon.streaming),
      truncated: flag(balloon.truncated),
      open: text(balloon.open, 80) ?? "",
      close: text(balloon.close, 40) ?? "",
      input: balloon.input && typeof balloon.input === "object"
        ? {
            label: text(balloon.input.label, 160) ?? "",
            placeholder: text(balloon.input.placeholder, 160) ?? "",
            send: text(balloon.input.send, 40) ?? "",
          }
        : null,
    };
  }
  return snapshot;
}

const EVENT_TYPES = new Set(["click", "context", "dismiss", "open", "menu", "send", "play", "pet", "mascot"]);
export const SEND_MAX = 4000;

/** What a floating window may report back: a click, a menu choice, or typed text. */
export function sanitizeFloatingEvent(value) {
  if (!value || typeof value !== "object" || !EVENT_TYPES.has(value.type)) return null;
  if (value.type === "menu") return ID_RE.test(value.id ?? "") ? { type: "menu", id: value.id } : null;
  if (value.type === "mascot") {
    const choice = mascotChoice(value.choice);
    return choice ? { type: "mascot", choice } : null;
  }
  if (value.type === "send") {
    if (typeof value.text !== "string") return null;
    const typed = value.text.slice(0, SEND_MAX);
    return typed.trim() ? { type: "send", text: typed } : null;
  }
  return { type: value.type };
}

/** Positions on disk: per display setup, per bot, the character's bottom-right corner. */
export function sanitizePositions(value) {
  const clean = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [signature, bots] of Object.entries(value).slice(0, 32)) {
    if (typeof signature !== "string" || signature.length > 512 || !bots || typeof bots !== "object") continue;
    const entry = {};
    for (const [botId, spot] of Object.entries(bots).slice(0, 64)) {
      if (isBotId(botId) && spot && isFiniteNumber(spot.x) && isFiniteNumber(spot.y)) entry[botId] = { x: spot.x, y: spot.y };
    }
    clean[signature] = entry;
  }
  return clean;
}

/* -------------------------------------------------------------- controller */

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {{ getAllDisplays(): any[]; getPrimaryDisplay(): any; getCursorScreenPoint?(): {x:number,y:number} }} deps.screen
 * @param {{ handle: Function; on: Function; removeHandler?: Function; removeListener?: Function }} deps.ipcMain
 * @param {() => (import("electron").BrowserWindow | null)} deps.getMainWindow
 * @param {() => string} deps.pageUrl       the app origin's floating-only page
 * @param {string} deps.preload             path to floating-bot-preload.cjs
 * @param {() => unknown} [deps.readPositions]
 * @param {(positions: Record<string, Record<string, {x:number,y:number}>>) => void} [deps.writePositions]
 * @param {(event: any) => boolean} [deps.isTrustedMain]  the sender is the local app page
 * @param {() => void} [deps.focusMain]     bring the app window forward ("Open in the app")
 * @param {string} [deps.platform]          process.platform by default
 * @param {(line: string) => void} [deps.log]
 */
export function createFloatingBotWindows(deps) {
  const { BrowserWindow, screen, ipcMain, getMainWindow, pageUrl, preload } = deps;
  // Linux cannot forward pointer moves through an ignoring window, so there
  // the small window simply stays clickable rather than becoming unreachable.
  const clickThrough = (deps.platform ?? process.platform) !== "linux";
  const log = deps.log ?? (() => {});
  /** botId -> { win, snapshot, onTop, autopilot } */
  const floats = new Map();
  let positions = null;
  let silent = false;

  const savedPositions = () => {
    if (positions) return positions;
    try {
      positions = sanitizePositions(deps.readPositions?.());
    } catch {
      positions = {};
    }
    return positions;
  };

  const workAreas = () => screen.getAllDisplays().map((display) => display.workArea);
  const signature = () => displaySignature(screen.getAllDisplays());
  const live = (entry) => Boolean(entry && entry.win && !entry.win.isDestroyed());
  /** The floating window that sent this event, or null: this is how a window's channel is its own. */
  const senderFloat = (event) => {
    if (!event?.sender) return null;
    for (const [botId, entry] of floats) {
      if (live(entry) && entry.win.webContents === event.sender) return { botId, entry };
    }
    return null;
  };
  const isMain = (event) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event?.sender !== main.webContents) return false;
    // a remote server's page in the main window never drives these windows
    return deps.isTrustedMain ? deps.isTrustedMain(event) : true;
  };

  const notifyMain = (channel, payload) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(channel, payload);
  };

  const remember = (botId) => {
    const entry = floats.get(botId);
    // the mascot flying off or wandering is not the person choosing a spot
    if (!live(entry) || entry.autopilot) return;
    const { x, y, width, height } = entry.win.getBounds();
    const all = savedPositions();
    const key = signature();
    // the character stands at the bottom-right corner whatever the balloon does
    all[key] = { ...all[key], [botId]: { x: x + width, y: y + height } };
    try {
      deps.writePositions?.(all);
    } catch {
      /* the spot is only a convenience */
    }
  };

  const startBounds = (botId) => {
    const saved = savedPositions()[signature()]?.[botId];
    const bounds = saved
      ? { x: saved.x - FLOAT_SIZE.width, y: saved.y - FLOAT_SIZE.height, ...FLOAT_SIZE }
      : floatingDefaultBounds(screen.getPrimaryDisplay().workArea, floats.size);
    return clampToDisplays(bounds, workAreas());
  };

  const applyOnTop = (win, on) => {
    try {
      if (on) win.setAlwaysOnTop(true, "floating");
      else win.setAlwaysOnTop(false);
    } catch {
      /* platform without levels: the window still works */
    }
  };

  function open(botId, { alwaysOnTop = true } = {}) {
    const existing = floats.get(botId);
    if (live(existing)) {
      if (existing.onTop !== alwaysOnTop) {
        existing.onTop = alwaysOnTop;
        applyOnTop(existing.win, alwaysOnTop);
      }
      return existing.win;
    }
    if (floats.size >= MAX_FLOATING) return null;
    const options = assistantWindowOptions({ preload, bounds: startBounds(botId), title: "Floating bot" });
    // throttled when hidden or covered, so the 3D mascot stops drawing (and spending battery) there
    const created = new BrowserWindow({ ...options, alwaysOnTop, webPreferences: { ...options.webPreferences, backgroundThrottling: true } });
    const entry = { win: created, snapshot: existing?.snapshot ?? null, onTop: alwaysOnTop, autopilot: false };
    floats.set(botId, entry);
    applyOnTop(created, alwaysOnTop);
    try {
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
    created.on("moved", () => remember(botId));
    created.once("closed", () => {
      if (floats.get(botId)?.win !== created) return;
      floats.delete(botId);
      // closed from outside the brain (a window shortcut): the bot goes back in the app
      if (!silent) notifyMain("floating-bots:closed", { botId });
    });
    void created.loadURL(pageUrl()).catch((error) => log(`floating bot window failed to load: ${error?.message ?? error}`));
    return created;
  }

  function close(botId) {
    const entry = floats.get(botId);
    floats.delete(botId);
    if (live(entry)) entry.win.destroy();
  }

  /** Close every window without telling the brain: it is gone, or the app is quitting. */
  function closeAll() {
    silent = true;
    try {
      for (const botId of floats.keys()) close(botId);
    } finally {
      silent = false;
    }
  }

  /* ---------------------------------------------------------------- IPC */

  const handlers = {
    "floating-bots:open": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId)) return false;
      return Boolean(open(request.botId, { alwaysOnTop: request.alwaysOnTop !== false }));
    },
    "floating-bots:close": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId)) return false;
      close(request.botId);
      return true;
    },
    "floating-bots:set-top": (event, request) => {
      if (!isMain(event) || !request || !isBotId(request.botId) || typeof request.on !== "boolean") return false;
      const entry = floats.get(request.botId);
      if (!live(entry)) return false;
      entry.onTop = request.on;
      applyOnTop(entry.win, request.on);
      return true;
    },
    "floating-bots:list": (event) => {
      if (!isMain(event)) return [];
      return [...floats.keys()];
    },
    "floating-bots:move-by": (event, delta) => {
      const found = senderFloat(event);
      if (!found || !delta || !isFiniteNumber(delta.dx) || !isFiniteNumber(delta.dy)) return null;
      const { win } = found.entry;
      const bounds = win.getBounds();
      const next = clampToDisplays(
        { ...bounds, x: bounds.x + clampNumber(delta.dx, -MAX_MOVE, MAX_MOVE), y: bounds.y + clampNumber(delta.dy, -MAX_MOVE, MAX_MOVE) },
        workAreas(),
      );
      win.setBounds(next);
      return { x: next.x, y: next.y };
    },
    "floating-bots:move-to": (event, point) => {
      const found = senderFloat(event);
      if (!found || !point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
      const { win } = found.entry;
      const next = clampToDisplays({ ...win.getBounds(), x: Math.round(point.x), y: Math.round(point.y) }, workAreas());
      win.setBounds(next);
      return next;
    },
    "floating-bots:geometry": (event) => {
      const found = senderFloat(event);
      if (!found) return null;
      const bounds = found.entry.win.getBounds();
      const areas = workAreas();
      if (!areas.length) return null;
      // the display the window stands on: clamping a copy of it picks the same area main would
      const clamped = clampToDisplays(bounds, areas);
      const workArea = areas.find((area) =>
        clamped.x >= area.x && clamped.y >= area.y && clamped.x + clamped.width <= area.x + area.width && clamped.y + clamped.height <= area.y + area.height,
      ) ?? areas[0];
      let cursor = null;
      try {
        const point = screen.getCursorScreenPoint?.();
        if (point && isFiniteNumber(point.x) && isFiniteNumber(point.y)) cursor = { x: point.x, y: point.y };
      } catch {
        /* no pointer to follow: the mascot looks ahead */
      }
      return { bounds, workArea: { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }, cursor };
    },
    "floating-bots:resize": (event, size) => {
      const found = senderFloat(event);
      if (!found || !size || !isFiniteNumber(size.width) || !isFiniteNumber(size.height)) return null;
      const { win } = found.entry;
      const bounds = win.getBounds();
      const width = Math.round(clampNumber(size.width, FLOAT_MIN.width, FLOAT_MAX.width));
      const height = Math.round(clampNumber(size.height, FLOAT_MIN.height, FLOAT_MAX.height));
      // grow up and to the left: the character's feet stay where they were
      const next = clampToDisplays({ x: bounds.x + bounds.width - width, y: bounds.y + bounds.height - height, width, height }, workAreas());
      win.setBounds(next);
      return next;
    },
  };

  const listeners = {
    "floating-bots:update": (event, message) => {
      if (!isMain(event) || !message || !isBotId(message.botId)) return;
      const clean = sanitizeFloatingSnapshot(message.snapshot);
      if (!clean) return;
      const entry = floats.get(message.botId);
      if (!live(entry)) return;
      entry.snapshot = clean;
      entry.win.webContents.send("floating-bot:state", clean);
    },
    "floating-bots:ready": (event) => {
      const found = senderFloat(event);
      if (found?.entry.snapshot) found.entry.win.webContents.send("floating-bot:state", found.entry.snapshot);
    },
    "floating-bots:event": (event, value) => {
      const found = senderFloat(event);
      if (!found) return;
      const clean = sanitizeFloatingEvent(value);
      if (!clean) return;
      // "Open in the app" brings the app forward from here: the window is not focused
      if (clean.type === "open" || (clean.type === "menu" && clean.id === "open")) {
        try {
          deps.focusMain?.();
        } catch {
          /* the brain still switches the thread */
        }
      }
      // the bot id comes from which window spoke, never from the payload
      notifyMain("floating-bots:event", { botId: found.botId, event: clean });
    },
    "floating-bots:set-interactive": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean" || !clickThrough) return;
      try {
        found.entry.win.setIgnoreMouseEvents(!on, { forward: true });
      } catch {
        /* keep the last state */
      }
    },
    "floating-bots:set-focusable": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean") return;
      try {
        found.entry.win.setFocusable(on);
        if (on) found.entry.win.focus();
      } catch {
        /* keep the last state */
      }
    },
    "floating-bots:autopilot": (event, on) => {
      const found = senderFloat(event);
      if (found && typeof on === "boolean") found.entry.autopilot = on;
    },
    "floating-bots:moved": (event) => {
      const found = senderFloat(event);
      if (found) remember(found.botId);
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  for (const [channel, handler] of Object.entries(listeners)) ipcMain.on(channel, handler);

  return {
    /** For tests and for main's lifecycle hooks. */
    window(botId) {
      const entry = floats.get(botId);
      return live(entry) ? entry.win : null;
    },
    get botIds() {
      return [...floats.keys()];
    },
    open,
    close,
    closeAll,
    /** The main window is gone (closed or crashed): its brain went with it. */
    mainWindowGone: closeAll,
    dispose() {
      closeAll();
      for (const channel of Object.keys(handlers)) ipcMain.removeHandler?.(channel);
      for (const [channel, handler] of Object.entries(listeners)) ipcMain.removeListener?.(channel, handler);
    },
  };
}
