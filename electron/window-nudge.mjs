// Shake the main Sagax window a few pixels and bring it forward once.
// A second call while the shake is running does nothing, so focus is not
// taken in a loop. A maximized or fullscreen window is not moved (that
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

/** `schedule` is setTimeout. Tests pass a queue. It must not run the
 * callback before returning, or the steps recurse. `activateApp` is the
 * shell's app.focus (macOS steal), so the window comes in front of other
 * apps. Both people in the chat call this once, from their own desktop. */
export function createWindowNudger(schedule = (fn, ms) => setTimeout(fn, ms), activateApp) {
  let running = false;
  return {
    /** Focus and shake `win` (the main window). False when a shake is
     * already running or the window is gone. */
    nudge(win) {
      if (gone(win) || running) return false;
      running = true;
      const origin = typeof win.getBounds === "function" ? win.getBounds() : null;
      const maximized = Boolean(
        (typeof win.isMaximized === "function" && win.isMaximized())
        || (typeof win.isFullScreen === "function" && win.isFullScreen()),
      );
      if (typeof win.isMinimized === "function" && win.isMinimized()) win.restore?.();
      win.show?.();
      win.moveTop?.();
      win.focus?.();
      if (typeof activateApp === "function") activateApp();
      if (maximized) shakeContent(win, schedule);
      let index = 0;
      const step = () => {
        if (gone(win)) {
          running = false;
          return;
        }
        const shift = NUDGE_SHIFTS[index];
        index += 1;
        if (!shift) {
          if (!maximized && origin) win.setBounds?.(origin);
          running = false;
          return;
        }
        if (!maximized && origin) {
          win.setBounds?.({
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
