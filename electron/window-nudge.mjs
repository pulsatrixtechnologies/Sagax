// Shake the main Sagax window a few pixels and bring it to the very front
// (restored, shown, on this Space, above other apps for the length of the
// shake, focused). A second call while the shake is running does nothing,
// so focus is not taken in a loop. A maximized or fullscreen window is not moved (that
// would leave maximized mode). Its page gets the same shake in CSS.
// The original pass was six steps (490ms). One extra second of the same
// wiggle is added on top.

export const NUDGE_STEP_MS = 70;
export const NUDGE_EXTRA_MS = 1000;

const NUDGE_WIGGLE = [
  { x: 6, y: 0 },
  { x: -6, y: 1 },
  { x: 4, y: -1 },
  { x: -3, y: 0 },
  { x: 2, y: 0 },
];

const EXTRA_STEPS = Math.round(NUDGE_EXTRA_MS / NUDGE_STEP_MS);

export const NUDGE_SHIFTS = [
  ...Array.from({ length: NUDGE_WIGGLE.length + EXTRA_STEPS }, (_, i) => NUDGE_WIGGLE[i % NUDGE_WIGGLE.length]),
  { x: 0, y: 0 },
];

const NUDGE_CYCLE_MS = (NUDGE_WIGGLE.length + 1) * NUDGE_STEP_MS;
const NUDGE_CSS_REPEATS = Math.max(1, Math.ceil((NUDGE_SHIFTS.length * NUDGE_STEP_MS) / NUDGE_CYCLE_MS));

const NUDGE_CSS = [
  `html.sagax-nudge{animation:sagax-nudge ${NUDGE_CYCLE_MS}ms linear ${NUDGE_CSS_REPEATS}}`,
  "@keyframes sagax-nudge{",
  "0%,100%{transform:none}",
  "16%{transform:translate(6px,0)}",
  "33%{transform:translate(-6px,1px)}",
  "50%{transform:translate(4px,-1px)}",
  "66%{transform:translate(-3px,0)}",
  "83%{transform:translate(2px,0)}",
  "}",
].join("");

function gone(win) {
  return !win || (typeof win.isDestroyed === "function" && win.isDestroyed());
}

function shakeContent(win, schedule) {
  const contents = win.webContents;
  if (!contents || typeof contents.insertCSS !== "function") return;
  let pending;
  try { pending = contents.insertCSS(NUDGE_CSS); } catch { return; }
  const apply = (key) => {
    if (typeof contents.executeJavaScript === "function") {
      const added = contents.executeJavaScript("document.documentElement.classList.add('sagax-nudge')");
      if (added && typeof added.catch === "function") added.catch(() => {});
    }
    schedule(() => {
      try { contents.removeInsertedCSS?.(key); } catch { /* the page is gone */ }
      if (typeof contents.executeJavaScript === "function") {
        const removed = contents.executeJavaScript("document.documentElement.classList.remove('sagax-nudge')");
        if (removed && typeof removed.catch === "function") removed.catch(() => {});
      }
    }, NUDGE_SHIFTS.length * NUDGE_STEP_MS);
  };
  if (pending && typeof pending.then === "function") pending.then(apply).catch(() => {});
  else apply(pending);
}

/** How long the window stays above every other window, so it lands in
 * front even when the system refuses a plain focus (Windows foreground
 * lock, another Space on macOS). Then it goes back to a normal window. */
export const NUDGE_TOP_MS = NUDGE_SHIFTS.length * NUDGE_STEP_MS + 300;

function call(win, name, ...args) {
  const fn = win?.[name];
  if (typeof fn !== "function") return undefined;
  try {
    return fn.apply(win, args);
  } catch {
    return undefined;
  }
}

/** Bring `win` to the very front: out of the Dock or the taskbar, out of the
 * tray, onto the current Space, above every other app's windows for a
 * moment, focused. Returns how to put it back to a normal window. */
function bringToFront(win, platform, activateApp) {
  if (call(win, "isMinimized")) call(win, "restore");
  call(win, "show");
  const wasOnTop = call(win, "isAlwaysOnTop") === true;
  const wasOnAllSpaces = platform === "darwin" && call(win, "isVisibleOnAllWorkspaces") === true;
  // macOS: a window on another Space is shown on this one for the moment.
  // skipTransformProcessType keeps the Dock icon from blinking.
  if (platform === "darwin" && !wasOnAllSpaces) call(win, "setVisibleOnAllWorkspaces", true, { skipTransformProcessType: true });
  if (!wasOnTop) call(win, "setAlwaysOnTop", true, "screen-saver");
  call(win, "moveTop");
  if (typeof activateApp === "function") {
    try { activateApp(); } catch { /* the app could not be activated */ }
  }
  call(win, "focus");
  return () => {
    if (gone(win)) return;
    if (!wasOnTop) call(win, "setAlwaysOnTop", false);
    if (platform === "darwin" && !wasOnAllSpaces) call(win, "setVisibleOnAllWorkspaces", false, { skipTransformProcessType: true });
    // still in front once it is a normal window again
    call(win, "moveTop");
  };
}

/** `schedule` is setTimeout. Tests pass a queue. It must not run the
 * callback before returning, or the steps recurse. `activateApp` is the
 * shell's app.focus (macOS steal), so the window comes in front of other
 * apps. Both people in the chat call this, from their own desktop: the
 * person nudged and the sender. `platform` is process.platform. */
export function createWindowNudger(schedule = (fn, ms) => setTimeout(fn, ms), activateApp, platform = process.platform) {
  let running = false;
  return {
    /** Bring `win` (the main window) to the very front and shake it, unless
     * `shake` is false (it still comes forward). False when a shake is
     * already running or the window is gone. */
    nudge(win, { shake = true } = {}) {
      if (gone(win) || running) return false;
      running = true;
      const maximized = Boolean(call(win, "isMaximized") || call(win, "isFullScreen"));
      let release = () => {};
      try {
        release = bringToFront(win, platform, activateApp);
      } catch {
        // a window that cannot come forward still shakes
      }
      // the bounds once it is restored and shown
      const origin = typeof win.getBounds === "function" ? call(win, "getBounds") ?? null : null;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try { release(); } finally { running = false; }
      };
      // whatever happens to the steps, the window goes back to normal
      schedule(finish, NUDGE_TOP_MS);
      if (!shake) return true;
      if (maximized) shakeContent(win, schedule);
      let index = 0;
      const step = () => {
        if (gone(win)) {
          finish();
          return;
        }
        const shift = NUDGE_SHIFTS[index];
        index += 1;
        if (!shift) {
          if (!maximized && origin) call(win, "setBounds", origin);
          return;
        }
        if (!maximized && origin) {
          call(win, "setBounds", {
            x: origin.x + shift.x,
            y: origin.y + shift.y,
            width: origin.width,
            height: origin.height,
          });
        }
        schedule(step, NUDGE_STEP_MS);
      };
      schedule(step, NUDGE_STEP_MS);
      return true;
    },
  };
}
