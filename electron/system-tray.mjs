// The system tray: Windows notification area (Open / Quit) and the macOS menu
// bar (the bots' list: a dot in the bot's mascot color, "working" and unread
// state, Cmd+Shift+N to open one). The page (the brain) sends the roster; this
// module only turns it into a menu. The menu model is pure and covered by
// node:test (electron/system-tray.node-test.mjs).

/** Most bots the menu lists (one global shortcut each, 1 to 9). */
export const MAX_TRAY_BOTS = 9;
const MAX_NAME = 60;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** What the page may send, checked: at most nine bots, text capped, no id shown. */
export function normalizeRoster(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (out.length >= MAX_TRAY_BOTS) break;
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200 ? item.id : "";
    const name = typeof item.name === "string" ? item.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
    if (!id || !name) continue;
    const unread = Number.isFinite(item.unread) ? Math.max(0, Math.min(99, Math.floor(item.unread))) : item.unread === true ? 1 : 0;
    out.push({
      id,
      name,
      color: typeof item.color === "string" && HEX.test(item.color) ? item.color : "#8E8E93",
      working: item.working === true,
      unread,
    });
  }
  return out;
}

/** macOS reserves Cmd+Shift+3, 4 and 5 for screenshots: a bot never takes them. */
export function slotAccelerator(slot, platform = process.platform) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_TRAY_BOTS) return null;
  if (platform === "darwin" && slot >= 3 && slot <= 5) return null;
  return `CommandOrControl+Shift+${slot}`;
}

/** The menu line's text: the name, then its state. */
export function rosterLabel(bot) {
  const state = bot.working ? "working" : bot.unread > 0 ? (bot.unread > 1 ? `${bot.unread} unread` : "unread") : "";
  return state ? `${bot.name} (${state})` : bot.name;
}

/**
 * The tray menu as an Electron template.
 * @param {{ roster: ReturnType<typeof normalizeRoster>, platform?: string, icon?: (bot: object) => unknown, onOpenBot: (id: string) => void, onShow: () => void, onQuit: () => void }} input
 */
export function buildTrayMenuTemplate({ roster, platform = process.platform, icon, onOpenBot, onShow, onQuit }) {
  const items = [];
  const bots = normalizeRoster(roster);
  const unreadTotal = bots.reduce((sum, bot) => sum + bot.unread, 0);
  if (bots.length > 0) {
    items.push({ label: unreadTotal > 0 ? `Bots (${unreadTotal} unread)` : "Bots", enabled: false });
    bots.forEach((bot, index) => {
      const accelerator = slotAccelerator(index + 1, platform);
      const image = icon?.(bot);
      items.push({
        label: rosterLabel(bot),
        ...(image ? { icon: image } : {}),
        // shown beside the name; the global shortcut itself is registered by mascot-hotkey.mjs
        ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
        click: () => onOpenBot(bot.id),
      });
    });
    items.push({ type: "separator" });
  }
  items.push({ label: "Open Sagax", click: onShow });
  items.push({ type: "separator" });
  items.push({ label: "Quit Sagax", click: onQuit });
  return items;
}

/**
 * A 16 px (drawn at `scale` x) round dot in the bot's mascot color, as the
 * BGRA bitmap nativeImage.createFromBitmap reads. A working bot gets a white
 * center. Anti-aliased by coverage of the edge.
 */
export function statusDotBitmap(color, { working = false, size = 16, scale = 2 } = {}) {
  const hex = HEX.test(String(color)) ? String(color) : "#8E8E93";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const px = size * scale;
  const buffer = Buffer.alloc(px * px * 4);
  const mid = (px - 1) / 2;
  const outer = px / 2 - 1.5 * scale;
  const inner = outer * 0.4;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x - mid, y - mid);
      const alpha = Math.max(0, Math.min(1, outer - d + 0.5));
      const core = working ? Math.max(0, Math.min(1, inner - d + 0.5)) : 0;
      const at = (y * px + x) * 4;
      buffer[at] = Math.round(b + (255 - b) * core);
      buffer[at + 1] = Math.round(g + (255 - g) * core);
      buffer[at + 2] = Math.round(r + (255 - r) * core);
      buffer[at + 3] = Math.round(alpha * 255);
    }
  }
  return { buffer, width: px, height: px, scaleFactor: scale };
}

// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit, platform = process.platform, onOpenBot = () => {} }) {
  const mac = platform === "darwin";
  const tray = mac
    ? new Tray(nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }))
    : new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
      "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let roster = [];
  const dots = new Map();
  const dotFor = (bot) => {
    if (typeof nativeImage.createFromBitmap !== "function") return undefined;
    const key = `${bot.color}:${bot.working}`;
    if (!dots.has(key)) {
      const { buffer, width, height, scaleFactor } = statusDotBitmap(bot.color, { working: bot.working });
      dots.set(key, nativeImage.createFromBitmap(buffer, { width, height, scaleFactor }));
    }
    return dots.get(key);
  };
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  tray.setToolTip("Sagax");
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
      roster, platform, icon: dotFor, onOpenBot, onShow: show, onQuit,
    })));
  };
  rebuild();
  // macOS opens the menu on a click; Windows opens the window.
  if (!mac) {
    tray.on("click", show);
    tray.on("double-click", show);
  }
  return {
    show,
    /** The page's bots: the menu lists them (macOS and Windows). Returns the checked roster. */
    setRoster(value) {
      roster = normalizeRoster(value);
      rebuild();
      const unread = roster.reduce((sum, bot) => sum + bot.unread, 0);
      const working = roster.filter((bot) => bot.working).length;
      tray.setToolTip(unread > 0 ? `Sagax (${unread} unread)` : working > 0 ? `Sagax (${working} working)` : "Sagax");
      return roster;
    },
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
