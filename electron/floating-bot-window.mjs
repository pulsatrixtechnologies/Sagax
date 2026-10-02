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
/** Room for the mascot and a resized, moved balloon (the balloon itself caps at about 60 % of the work area). */
export const FLOAT_MAX = Object.freeze({ width: 1100, height: 1100 });
/** More than this many floating windows is a mistake, not a desk. */
export const MAX_FLOATING = 12;
const MAX_MOVE = 4000;
/** A page that failed or died is reloaded this many times at most, a little later each time. */
const MAX_RELOADS = 3;
const RELOAD_DELAY_MS = 800;
/** A page that has not said it is ready after this long is reloaded. */
export const READY_TIMEOUT_MS = 12_000;
/** A move is saved once the window has stood still this long (macOS reports every step of a move). */
export const REMEMBER_DELAY_MS = 500;

/** Resolves once `url` answers (or after `tries`): a development page server may still be starting. */
export async function waitForPage(url, { fetchImpl = globalThis.fetch, tries = 40, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

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
/** Earlier exchanges kept in a balloon, and how much of each. */
export const HISTORY_MAX = 4;
export const HISTORY_TEXT_MAX = 2000;
const ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;
const POSES = new Set(["idle", "think", "speak", "celebrate", "alert", "sleep"]);
const BALLOON_KINDS = new Set(["chat", "thinking", "approval", "error"]);
const TASKS = new Set(["idle", "working", "waiting", "error"]);
const LIVELINESS = new Set(["calm", "normal", "lively"]);
const MAX_TOKENS = 1e9;
const CHARACTERS = new Set(["owl", "shape", "trombi"]);
const SHAPES = new Set(["circle", "cloud", "squircle", "sparkle", "clover", "bean", "flower", "drop", "pill", "pick", "house", "star", "hexagon"]);
/** Shapes from the first set, renamed or replaced (shared/mascot-look.ts LEGACY_SHAPES). */
const LEGACY_SHAPES = { blob: "bean", triangle: "pick" };
const SHAPE_SKINS = new Set(["plain", "pastel", "glossy", "night", "outline", "gold", "neon", "chrome", "crystal", "circuit", "holo", "molten", "galaxy"]);
const TROMBI_SKINS = new Set(["classic", "retro98", "gold", "neon", "chrome", "glitch", "holo", "molten"]);
/** Other names a stored skin may carry (shared/mascot-look.ts LEGACY_SHAPE_SKINS, LEGACY_TROMBI_SKINS). */
const LEGACY_SHAPE_SKINS = { ink: "outline", royal: "gold", metal: "chrome", "liquid-metal": "chrome", glass: "crystal", cyber: "circuit", iridescent: "holo", holographic: "holo", lava: "molten", nebula: "galaxy" };
const LEGACY_TROMBI_SKINS = { retro: "retro98", win98: "retro98", royal: "gold", metal: "chrome", cyber: "glitch", iridescent: "holo", holographic: "holo", lava: "molten" };
/** The app's skins (src/lib/skins.ts SKIN_IDS): the balloon wears the one the app wears. */
export const APP_SKINS = new Set(["pulsatrix", "pulsatrix-light", "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "retro98"]);
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

/** The app's theme for the balloon: a known skin and a plain hex accent, or nothing. */
export function appTheme(value) {
  if (!value || typeof value !== "object" || !APP_SKINS.has(value.skin)) return null;
  return { skin: value.skin, ...(typeof value.accent === "string" && ACCENT_RE.test(value.accent) ? { accent: value.accent } : {}) };
}
const skinOf = (value, legacy) => (typeof value === "string" && Object.hasOwn(legacy, value) ? legacy[value] : value);

/** The bot's character and its look (shared/mascot-look.ts): known values only. */
export function mascotLook(value) {
  if (!value || typeof value !== "object" || !CHARACTERS.has(value.character)) return null;
  const skins = value.skins && typeof value.skins === "object" ? value.skins : {};
  const cleanSkins = {
    ...(SHAPE_SKINS.has(skinOf(skins.shape, LEGACY_SHAPE_SKINS)) ? { shape: skinOf(skins.shape, LEGACY_SHAPE_SKINS) } : {}),
    ...(TROMBI_SKINS.has(skinOf(skins.trombi, LEGACY_TROMBI_SKINS)) ? { trombi: skinOf(skins.trombi, LEGACY_TROMBI_SKINS) } : {}),
  };
  return {
    character: value.character,
    ...(value.style === "2d" || value.style === "3d" ? { style: value.style } : {}),
    ...(SHAPES.has(LEGACY_SHAPES[value.shape] ?? value.shape) ? { shape: LEGACY_SHAPES[value.shape] ?? value.shape } : {}),
    ...(Object.keys(cleanSkins).length ? { skins: cleanSkins } : {}),
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

const CALL_PHASES = new Set(["connecting", "listening", "hearing", "thinking", "speaking", "interrupted", "held", "ended"]);
const CALL_LINES = 8;
const CALL_TEXT_MAX = 1200;
const VOICE_ID_RE = /^[a-zA-Z0-9._-]{0,64}$/;
const LANGUAGE_RE = /^[a-zA-Z-]{2,16}$/;

/** The live voice call as the mascot shows it: states, short texts and the call's settings, nothing else. */
export function sanitizeCall(value) {
  if (!value || typeof value !== "object" || !CALL_PHASES.has(value.phase)) return null;
  const settings = value.settings && typeof value.settings === "object" ? value.settings : {};
  const callSettings = value.callSettings && typeof value.callSettings === "object" ? value.callSettings : {};
  const enrollment = value.enrollment && typeof value.enrollment === "object" ? value.enrollment : {};
  return {
    phase: value.phase,
    muted: flag(value.muted),
    botAudible: flag(value.botAudible),
    push: flag(value.push),
    startedAt: isFiniteNumber(value.startedAt) && value.startedAt > 0 ? value.startedAt : 0,
    line: text(value.line, CALL_TEXT_MAX) ?? "",
    transcript: Array.isArray(value.transcript)
      ? value.transcript.slice(-CALL_LINES).filter((line) => line && typeof line === "object" && typeof line.text === "string").map((line, index) => ({
          id: typeof line.id === "string" && ID_RE.test(line.id) ? line.id : `line-${index}`,
          who: line.who === "you" ? "you" : "bot",
          text: line.text.slice(0, CALL_TEXT_MAX),
          ...(line.interrupted === true ? { interrupted: true } : {}),
        }))
      : [],
    note: text(value.note, 300) ?? null,
    notice: text(value.notice, 300) ?? null,
    settings: {
      voice: typeof settings.voice === "string" && VOICE_ID_RE.test(settings.voice) ? settings.voice : "",
      speed: isFiniteNumber(settings.speed) ? clampNumber(settings.speed, 0.5, 2) : 1,
      language: typeof settings.language === "string" && (settings.language === "auto" || LANGUAGE_RE.test(settings.language)) ? settings.language : "auto",
    },
    callSettings: {
      input: callSettings.input === "push" ? "push" : "auto",
      onlyMyVoice: flag(callSettings.onlyMyVoice),
      earcons: callSettings.earcons !== false,
    },
    voices: Array.isArray(value.voices)
      ? value.voices.slice(0, 64).filter((voice) => voice && typeof voice.id === "string" && VOICE_ID_RE.test(voice.id) && typeof voice.label === "string").map((voice) => ({ id: voice.id, label: voice.label.slice(0, 80) }))
      : null,
    voicesError: text(value.voicesError, 200) ?? null,
    enrollment: enrollment.state === "recording"
      ? { state: "recording", share: isFiniteNumber(enrollment.share) ? clampNumber(enrollment.share, 0, 1) : 0 }
      : { state: enrollment.state === "enrolled" || enrollment.state === "failed" ? enrollment.state : "none" },
    previewing: value.previewing && typeof value.previewing.id === "string" && VOICE_ID_RE.test(value.previewing.id)
      ? { id: value.previewing.id, loading: flag(value.previewing.loading) }
      : null,
  };
}

/**
 * Where the mascot's native menu opens, for Menu.popup (window coordinates,
 * DIP): exactly at the click, which the page reports in CSS pixels (times the
 * page's zoom to get DIP; the display's scale factor is the OS's business),
 * kept inside the work area of the display under it (or the nearest one), so
 * it never opens under the menu bar or the Dock or off a screen.
 */
export function menuPopupPoint(click, zoom, bounds, areas) {
  const factor = isFiniteNumber(zoom) && zoom > 0 ? zoom : 1;
  const sx = bounds.x + (isFiniteNumber(click?.x) ? click.x : 0) * factor;
  const sy = bounds.y + (isFiniteNumber(click?.y) ? click.y : 0) * factor;
  const distance = (area) => Math.hypot(sx - clampNumber(sx, area.x, area.x + area.width - 1), sy - clampNumber(sy, area.y, area.y + area.height - 1));
  const area = (areas ?? []).reduce((best, candidate) => (!best || distance(candidate) < distance(best) ? candidate : best), null);
  const x = area ? clampNumber(sx, area.x, area.x + area.width - 1) : sx;
  const y = area ? clampNumber(sy, area.y, area.y + area.height - 1) : sy;
  return { x: Math.round(x - bounds.x), y: Math.round(y - bounds.y) };
}

/** The call's two levels, 0..1. */
export function sanitizeLevels(value) {
  if (!value || typeof value !== "object" || !isFiniteNumber(value.bot) || !isFiniteNumber(value.mic)) return null;
  return { bot: clampNumber(value.bot, 0, 1), mic: clampNumber(value.mic, 0, 1) };
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
    // the bot's id, so the balloon can remember its size and place per bot
    id: isBotId(value.id) ? value.id : "",
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
      ...(typeof value.hints?.pin === "string" ? { pin: value.hints.pin.slice(0, 80) } : {}),
      // present when the bot takes voice calls: the call button's label
      ...(typeof value.hints?.call === "string" ? { call: value.hints.call.slice(0, 80) } : {}),
    },
    liveliness: LIVELINESS.has(value.liveliness) ? value.liveliness : "normal",
    context: context(value.context),
    mascot: mascotLook(value.mascot) ?? { character: "owl" },
  };
  const theme = appTheme(value.theme);
  if (theme) snapshot.theme = theme;
  snapshot.call = sanitizeCall(value.call);
  const balloon = value.balloon;
  if (balloon && typeof balloon === "object" && BALLOON_KINDS.has(balloon.kind)) {
    snapshot.balloon = {
      kind: balloon.kind,
      title: text(balloon.title, 160),
      asked: text(balloon.asked, 300),
      text: text(balloon.text, REPLY_MAX) ?? "",
      // earlier exchanges of this conversation, oldest first (a few, bounded)
      history: Array.isArray(balloon.history)
        ? balloon.history.slice(-HISTORY_MAX).filter((item) => item && typeof item === "object").map((item) => ({
            asked: text(item.asked, 300) ?? "",
            text: text(item.text, HISTORY_TEXT_MAX) ?? "",
          }))
        : [],
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

const EVENT_TYPES = new Set(["click", "context", "dismiss", "open", "menu", "send", "play", "pet", "call"]);
const CALL_ACTIONS = new Set(["start", "end", "mute", "unmute", "hold", "resume", "interrupt", "retry", "talk", "release", "voices", "enroll", "forget", "preview", "settings", "call-settings"]);
/** The settings a mascot's call may change, and how each is checked. */
const CALL_PATCH = {
  settings: { voice: (v) => typeof v === "string" && VOICE_ID_RE.test(v), speed: (v) => isFiniteNumber(v) && v >= 0.5 && v <= 2, language: (v) => typeof v === "string" && (v === "auto" || LANGUAGE_RE.test(v)) },
  "call-settings": { input: (v) => v === "auto" || v === "push", onlyMyVoice: (v) => typeof v === "boolean", earcons: (v) => typeof v === "boolean" },
};
export const SEND_MAX = 4000;

/** What a floating window may report back: a click, a menu choice, or typed text. */
export function sanitizeFloatingEvent(value) {
  if (!value || typeof value !== "object" || !EVENT_TYPES.has(value.type)) return null;
  if (value.type === "menu") return ID_RE.test(value.id ?? "") ? { type: "menu", id: value.id } : null;
  if (value.type === "send") {
    if (typeof value.text !== "string") return null;
    const typed = value.text.slice(0, SEND_MAX);
    return typed.trim() ? { type: "send", text: typed } : null;
  }
  if (value.type === "call") {
    if (!CALL_ACTIONS.has(value.action)) return null;
    if (value.action === "preview") return typeof value.voice === "string" && VOICE_ID_RE.test(value.voice) ? { type: "call", action: "preview", voice: value.voice } : null;
    const rules = CALL_PATCH[value.action];
    if (rules) {
      const patch = {};
      if (value.patch && typeof value.patch === "object") for (const [key, check] of Object.entries(rules)) if (Object.hasOwn(value.patch, key) && check(value.patch[key])) patch[key] = value.patch[key];
      return Object.keys(patch).length ? { type: "call", action: value.action, patch } : null;
    }
    return { type: "call", action: value.action };
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
 * @param {(event: any) => boolean} [deps.isTrustedMain]  the sender is this app's own UI (local, or bundled on an organization server)
 * @param {() => Promise<unknown>} [deps.whenReady]  resolves once Electron's app is ready (the screen module needs it)
 * @param {() => void} [deps.focusMain]     bring the app window forward ("Open in the app")
 * @param {() => (import("electron").Session | null)} [deps.session]  the session for the page (server mode without a local server)
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
  /**
   * The latest snapshot for a bot whose window is not open (yet): the brain
   * may send it a moment before the window exists, and only sends again when
   * something changes, so it is kept for the window that opens next.
   */
  const pending = new Map();
  /** A diagnostic said once, not on every update. */
  const noted = new Set();
  const note = (line) => {
    if (noted.has(line) || noted.size > 50) return;
    noted.add(line);
    log(`floating bots: ${line}`);
  };
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

  /** Move or size a window only when that changes something; a move alone keeps its size untouched. */
  const place = (win, next) => {
    const now = win.getBounds();
    if (now.x === next.x && now.y === next.y && now.width === next.width && now.height === next.height) return;
    if (now.width === next.width && now.height === next.height) win.setPosition(next.x, next.y);
    else win.setBounds(next);
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
    const options = assistantWindowOptions({ preload, bounds: startBounds(botId), title: "Floating bot", session: deps.session?.() ?? undefined });
    // throttled when hidden or covered, so the 3D mascot stops drawing (and spending battery) there
    const created = new BrowserWindow({ ...options, alwaysOnTop, webPreferences: { ...options.webPreferences, backgroundThrottling: true } });
    // interactive and focusable as last set, so a repeated request costs nothing (and never flickers)
    const entry = { win: created, snapshot: existing?.snapshot ?? pending.get(botId) ?? null, onTop: alwaysOnTop, autopilot: false, interactive: !clickThrough, focusable: false };
    pending.delete(botId);
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
    // on macOS "moved" fires for every step of a move: save once it stops, never per frame
    created.on("moved", () => {
      clearTimeout(entry.rememberTimer);
      // a step of the mascot's own flight is not a spot to keep
      if (entry.autopilot) return;
      entry.rememberTimer = setTimeout(() => remember(botId), REMEMBER_DELAY_MS);
    });
    created.once("closed", () => {
      clearTimeout(entry.watchdog);
      clearTimeout(entry.rememberTimer);
      if (floats.get(botId)?.win !== created) return;
      floats.delete(botId);
      // closed from outside the brain (a window shortcut): the bot goes back in the app
      if (!silent) notifyMain("floating-bots:closed", { botId });
    });
    keepAlive(botId, entry);
    void load(entry);
    return created;
  }

  /*
   * A window whose page never loads, or dies, is an invisible mascot: the
   * window is there, transparent and empty. So a failed load is retried, a
   * dead page reloaded, a page that never says it is ready reloaded once,
   * and every error of the page reaches main's log.
   */
  const load = async (entry) => {
    if (!live(entry)) return;
    const url = pageUrl();
    // in development the page comes from Vite: wait until it answers rather than fail the first load
    if (deps.waitForPage) await deps.waitForPage(url).catch(() => undefined);
    if (!live(entry)) return;
    void entry.win.loadURL(url).catch((error) => log(`floating bot window failed to load: ${error?.message ?? error}`));
  };

  function keepAlive(botId, entry) {
    const { win } = entry;
    entry.ready = false;
    entry.retries = 0;
    const retry = (why) => {
      if (!live(entry) || entry.retries >= MAX_RELOADS) return;
      entry.retries += 1;
      log(`floating bot ${botId}: ${why}; reloading (${entry.retries}/${MAX_RELOADS})`);
      entry.ready = false;
      setTimeout(() => void load(entry), RELOAD_DELAY_MS * entry.retries);
    };
    win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      // -3 is an aborted load (a reload, or the window closing), not a failure
      if (isMainFrame !== false && code !== -3) retry(`page failed to load (${code} ${description})`);
    });
    win.webContents.on("render-process-gone", (_event, details) => retry(`page process gone (${details?.reason ?? "unknown"})`));
    win.webContents.on("console-message", (...args) => {
      // Electron passes one event object (newer) or (event, level, message, line, source)
      const [first, level, message] = args;
      const text = typeof first?.message === "string" ? first.message : message;
      const severity = typeof first?.level === "string" ? first.level : level;
      if (severity === "error" || severity === 3) log(`floating bot ${botId} page error: ${String(text).slice(0, 500)}`);
    });
    entry.watchdog = setTimeout(function check() {
      if (!live(entry) || entry.ready) return;
      retry("page never became ready");
      entry.watchdog = setTimeout(check, READY_TIMEOUT_MS);
    }, READY_TIMEOUT_MS);
  }

  /** A display was removed, added or resized: every mascot back inside what is left. */
  const reclamp = () => {
    const areas = workAreas();
    for (const [botId, entry] of floats) {
      if (!live(entry)) continue;
      const bounds = entry.win.getBounds();
      const next = clampToDisplays(bounds, areas);
      if (next.x !== bounds.x || next.y !== bounds.y || next.width !== bounds.width || next.height !== bounds.height) {
        entry.win.setBounds(next);
        log(`floating bot ${botId}: moved back on screen after a display change`);
      }
    }
  };
  // The screen module exists only after app "ready"; createFloatingBotWindows
  // can run earlier, so the display listeners wait for it.
  const listenDisplays = () => {
    for (const change of ["display-added", "display-removed", "display-metrics-changed"]) screen.on?.(change, reclamp);
  };
  if (deps.whenReady) void deps.whenReady().then(listenDisplays);
  else listenDisplays();

  function close(botId) {
    const entry = floats.get(botId);
    floats.delete(botId);
    // the same bot's next window starts from its last state (the brain may not send it again)
    if (entry?.snapshot) pending.set(botId, entry.snapshot);
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
      place(win, next);
      return { x: next.x, y: next.y };
    },
    "floating-bots:move-to": (event, point) => {
      const found = senderFloat(event);
      if (!found || !point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return null;
      const { win } = found.entry;
      const next = clampToDisplays({ ...win.getBounds(), x: Math.round(point.x), y: Math.round(point.y) }, workAreas());
      place(win, next);
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
      // the character's corner stays where it was: by default the bottom-right (the window grows
      // up and to the left); a balloon flipped below or to the right asks for the other corner
      const fromLeft = size.anchorX === "left";
      const fromTop = size.anchorY === "top";
      const next = clampToDisplays({
        x: fromLeft ? bounds.x : bounds.x + bounds.width - width,
        y: fromTop ? bounds.y : bounds.y + bounds.height - height,
        width,
        height,
      }, workAreas());
      place(win, next);
      return next;
    },
  };

  const listeners = {
    "floating-bots:update": (event, message) => {
      if (!isMain(event) || !message || !isBotId(message.botId)) {
        note(`update refused (${!isMain(event) ? "not the app page" : "bad bot id"})`);
        return;
      }
      const clean = sanitizeFloatingSnapshot(message.snapshot);
      if (!clean) {
        note(`state for ${message.botId} refused as malformed`);
        return;
      }
      const entry = floats.get(message.botId);
      if (!live(entry)) {
        // the window is about to open: keep it for then (a few bots at most)
        pending.delete(message.botId);
        pending.set(message.botId, clean);
        while (pending.size > MAX_FLOATING) pending.delete(pending.keys().next().value);
        return;
      }
      entry.snapshot = clean;
      entry.win.webContents.send("floating-bot:state", clean);
    },
    // a right click (or a long press) on the mascot: its menu, natively, right at the pointer
    "floating-bots:menu": (event, at) => {
      const found = senderFloat(event);
      const items = found?.entry.snapshot?.menu ?? [];
      if (!found || !deps.Menu || !items.length) return;
      const win = found.entry.win;
      let zoom = 1;
      try {
        zoom = win.webContents.getZoomFactor?.() ?? 1;
      } catch {
        /* the default zoom */
      }
      const point = menuPopupPoint(at, zoom, win.getBounds(), workAreas());
      const choose = (id) => {
        if (id === "open") {
          try {
            deps.focusMain?.();
          } catch {
            /* the brain still switches the thread */
          }
        }
        // the bot id comes from which window asked, never from the payload
        notifyMain("floating-bots:event", { botId: found.botId, event: { type: "menu", id } });
      };
      const menu = deps.Menu.buildFromTemplate(items.map((item) => ({
        label: item.label,
        ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
        click: () => choose(item.id),
      })));
      menu.popup({ window: win, x: point.x, y: point.y });
    },
    // the call's levels, many times a second: straight to that bot's window, never kept
    "floating-bots:level": (event, message) => {
      if (!isMain(event) || !message || !isBotId(message.botId)) return;
      const levels = sanitizeLevels(message.levels);
      const entry = floats.get(message.botId);
      if (levels && live(entry)) entry.win.webContents.send("floating-bot:level", levels);
    },
    "floating-bots:ready": (event) => {
      const found = senderFloat(event);
      if (found) found.entry.ready = true;
      if (found && !found.entry.snapshot) {
        note(`${found.botId} is ready but no state has come from the app yet; asking the app`);
        // pull, not only push: the app page sends this bot's state again
        notifyMain("floating-bots:want", { botId: found.botId });
      }
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
      if (!found || typeof on !== "boolean" || !clickThrough || found.entry.interactive === on) return;
      found.entry.interactive = on;
      try {
        found.entry.win.setIgnoreMouseEvents(!on, { forward: true });
      } catch {
        /* keep the last state */
      }
    },
    "floating-bots:set-focusable": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean") return;
      const { entry } = found;
      try {
        // each call is a round trip to the window server: only a change, and focus only when it is not already there
        if (entry.focusable !== on) entry.win.setFocusable(on);
        entry.focusable = on;
        if (on && !entry.win.isFocused()) entry.win.focus();
      } catch {
        /* keep the last state */
      }
    },
    "floating-bots:autopilot": (event, on) => {
      const found = senderFloat(event);
      if (!found || typeof on !== "boolean") return;
      found.entry.autopilot = on;
      if (on) clearTimeout(found.entry.rememberTimer);
    },
    "floating-bots:moved": (event) => {
      const found = senderFloat(event);
      if (!found) return;
      clearTimeout(found.entry.rememberTimer);
      remember(found.botId);
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
      for (const change of ["display-added", "display-removed", "display-metrics-changed"]) screen.removeListener?.(change, reclamp);
      for (const [channel, handler] of Object.entries(listeners)) ipcMain.removeListener?.(channel, handler);
    },
  };
}
