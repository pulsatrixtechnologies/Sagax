// Getting a person's attention from the desktop shell: a native notification
// that stays until it is dismissed, a Dock bounce on macOS, a flashing
// taskbar button on Windows and Linux, and the unread count on the app icon
// (macOS Dock, Linux launcher; Windows uses the overlay icon in main.mjs).
// The page decides WHAT is worth it (src/lib/attention.ts); this module only
// does it. Kept free of Electron imports so node:test covers every rule.
//
// macOS shows a notification as a banner (it slides away) or as an alert
// (it stays) depending on the person's choice in System Settings >
// Notifications > Sagax; an app cannot force Alerts. `timeoutType: "never"`
// is honoured on Windows and Linux. The Settings help text says so.

const MAX_TITLE = 120;
const MAX_BODY = 400;
const MAX_ID = 200;
const MAX_KEPT = 50;

/** Text shown in a notification: a string, trimmed and capped. */
function clip(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The request the page sent, reduced to what a notification may carry.
 * Null when it has nothing to show. */
export function normalizeAttentionRequest(value) {
  if (!value || typeof value !== "object") return null;
  const title = clip(value.title, MAX_TITLE);
  if (!title) return null;
  const id = typeof value.id === "string" && value.id.length <= MAX_ID ? value.id : "";
  const bounce = value.bounce === "critical" || value.bounce === "informational" ? value.bounce : null;
  return {
    id,
    title,
    body: clip(value.body, MAX_BODY),
    sound: value.sound !== false,
    persistent: value.persistent !== false,
    bounce,
    flash: value.flash === true,
    target: normalizeTarget(value.target),
  };
}

/** Where a click goes: the bot, thread, room or routine run the notification
 * is about, so the page can open it even when it forgot the notification id
 * (a reload while the banner sat in the notification center). Null when
 * nothing usable came. */
export function normalizeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const key of ["botId", "threadId", "groupId", "routineRunId"]) {
    const field = value[key];
    if (typeof field === "string" && field.length <= MAX_ID) out[key] = field;
  }
  return out.threadId || out.routineRunId || out.botId ? out : null;
}

/**
 * @param {{
 *   platform: string,
 *   app: { dock?: { bounce?: (type: string) => number, cancelBounce?: (id: number) => void }, setBadgeCount?: (count: number) => boolean },
 *   Notification?: { new (options: object): { show(): void, close?(): void, on(event: string, fn: () => void): void }, isSupported?(): boolean },
 *   getWindow: () => any,
 *   onClick: (id: string, target: object | null) => void,
 *   icon?: string,
 * }} deps
 */
export function createDesktopAttention(deps) {
  const kept = new Map();
  let bounceId = null;

  const liveWindow = () => {
    const win = deps.getWindow();
    return win && !(typeof win.isDestroyed === "function" && win.isDestroyed()) ? win : null;
  };

  const forget = (key) => {
    kept.delete(key);
  };

  /** Bounce the Dock icon (macOS) or flash the taskbar button (Windows,
   * Linux) until the window is focused. Nothing when it already is. */
  function requestAttention({ bounce = null, flash = false } = {}) {
    const win = liveWindow();
    if (win && typeof win.isFocused === "function" && win.isFocused()) return false;
    let asked = false;
    if (deps.platform === "darwin" && bounce && typeof deps.app.dock?.bounce === "function") {
      if (bounceId !== null) deps.app.dock.cancelBounce?.(bounceId);
      bounceId = deps.app.dock.bounce(bounce);
      asked = true;
    }
    if (deps.platform !== "darwin" && (flash || bounce) && win && typeof win.flashFrame === "function") {
      win.flashFrame(true);
      asked = true;
      if (typeof win.once === "function") win.once("focus", () => { try { win.flashFrame(false); } catch { /* gone */ } });
    }
    return asked;
  }

  /** Show one native notification. False when the platform has none. */
  function notify(raw) {
    const request = normalizeAttentionRequest(raw);
    if (!request) return false;
    requestAttention(request);
    const Notification = deps.Notification;
    if (!Notification || (typeof Notification.isSupported === "function" && !Notification.isSupported())) return false;
    const note = new Notification({
      title: request.title,
      body: request.body,
      silent: !request.sound,
      ...(request.persistent ? { timeoutType: "never", urgency: "critical" } : { timeoutType: "default", urgency: "normal" }),
      // macOS draws the notification's left icon from the app bundle and
      // treats `icon` as a right-hand attachment, so it is never passed there.
      ...(deps.icon && deps.platform !== "darwin" ? { icon: deps.icon } : {}),
    });
    // The click handler lives as long as the notification object does; keep
    // it until it is clicked or closed (a bounded number, oldest first).
    const key = Symbol(request.id || "notification");
    kept.set(key, note);
    if (kept.size > MAX_KEPT) forget(kept.keys().next().value);
    note.on("click", () => {
      forget(key);
      const win = liveWindow();
      if (win) {
        if (typeof win.isMinimized === "function" && win.isMinimized()) win.restore?.();
        win.show?.();
        win.focus?.();
      }
      if (request.id) deps.onClick(request.id, request.target);
    });
    note.on("close", () => forget(key));
    note.show();
    return true;
  }

  /** The unread count on the app icon (macOS Dock, Linux launcher). */
  function setBadge(count) {
    const value = Number.isSafeInteger(count) && count > 0 ? count : 0;
    if (deps.platform === "darwin" || deps.platform === "linux") deps.app.setBadgeCount?.(value);
    return value;
  }

  /** The window came forward: stop asking. */
  function settle() {
    if (bounceId !== null) {
      deps.app.dock?.cancelBounce?.(bounceId);
      bounceId = null;
    }
    const win = liveWindow();
    if (win && deps.platform !== "darwin" && typeof win.flashFrame === "function") win.flashFrame(false);
  }

  return { notify, requestAttention, setBadge, settle, keptCount: () => kept.size };
}
