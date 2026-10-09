import assert from "node:assert/strict";
import test from "node:test";

import { NUDGE_EXTRA_MS, NUDGE_SHIFTS, NUDGE_STEP_MS, createWindowNudger } from "./window-nudge.mjs";

function fakeWindow(patch = {}) {
  const calls = [];
  const win = {
    destroyed: false,
    minimized: false,
    maximized: false,
    fullscreen: false,
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    isDestroyed: () => win.destroyed,
    isMinimized: () => win.minimized,
    isMaximized: () => win.maximized,
    isFullScreen: () => win.fullscreen,
    getBounds: () => ({ ...win.bounds }),
    setBounds: (next) => { calls.push(["bounds", next]); win.bounds = next; },
    restore: () => { calls.push(["restore"]); win.minimized = false; },
    show: () => { calls.push(["show"]); },
    focus: () => { calls.push(["focus"]); },
    ...patch,
  };
  return { win, calls };
}

function queuedTimer() {
  const queue = [];
  return {
    queue,
    schedule: (fn) => { queue.push(fn); return queue.length; },
    flush: () => { while (queue.length) queue.shift()(); },
  };
}

test("the shake is a few pixels and lasts about a second longer than the first pass", () => {
  for (const shift of NUDGE_SHIFTS) {
    assert.ok(Math.abs(shift.x) <= 8 && Math.abs(shift.y) <= 8);
  }
  assert.equal(NUDGE_SHIFTS.at(-1).x, 0);
  assert.equal(NUDGE_SHIFTS.at(-1).y, 0);
  const originalMs = 7 * NUDGE_STEP_MS;
  const duration = (NUDGE_SHIFTS.length + 1) * NUDGE_STEP_MS;
  assert.ok(Math.abs(duration - (originalMs + NUDGE_EXTRA_MS)) <= NUDGE_STEP_MS);
});

test("focuses and restores a minimized window once, then puts it back", () => {
  const { win, calls } = fakeWindow();
  win.minimized = true;
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule);
  assert.equal(nudger.nudge(win), true);
  assert.deepEqual(calls.map((call) => call[0]), ["restore", "show", "focus"]);
  timer.flush();
  assert.deepEqual(win.bounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.equal(calls.filter((call) => call[0] === "focus").length, 1);
  const moved = calls.filter((call) => call[0] === "bounds").map((call) => call[1]);
  assert.equal(moved[0].x, 16);
  assert.equal(moved.at(-1).x, 10);
});

test("a second nudge during the shake does not focus again", () => {
  const { win, calls } = fakeWindow();
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule);
  assert.equal(nudger.nudge(win), true);
  assert.equal(nudger.nudge(win), false);
  assert.equal(calls.filter((call) => call[0] === "focus").length, 1);
  timer.flush();
  assert.equal(nudger.nudge(win), true);
  assert.equal(calls.filter((call) => call[0] === "focus").length, 2);
});

test("brings the app in front, including when another app is active", () => {
  const { win, calls } = fakeWindow();
  win.moveTop = () => { calls.push(["moveTop"]); };
  const activated = [];
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule, () => { activated.push("app"); });
  assert.equal(nudger.nudge(win), true);
  assert.deepEqual(calls.map((call) => call[0]), ["show", "moveTop", "focus"]);
  assert.deepEqual(activated, ["app"]);
});

test("a maximized window is focused and not moved", () => {
  const { win, calls } = fakeWindow();
  win.maximized = true;
  const css = [];
  win.webContents = { insertCSS: (text) => { css.push(text); return "key"; } };
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule);
  assert.equal(nudger.nudge(win), true);
  timer.flush();
  assert.equal(calls.some((call) => call[0] === "bounds"), false);
  assert.equal(calls.filter((call) => call[0] === "focus").length, 1);
  assert.equal(css.length, 1);
  assert.match(css[0], /translate\(6px/);
  assert.match(css[0], /420ms linear 4/);
});

function frontWindow() {
  const { win, calls } = fakeWindow();
  win.onTop = false;
  win.allSpaces = false;
  win.isAlwaysOnTop = () => win.onTop;
  win.setAlwaysOnTop = (flag, level) => { calls.push(["top", flag, level]); win.onTop = flag; };
  win.isVisibleOnAllWorkspaces = () => win.allSpaces;
  win.setVisibleOnAllWorkspaces = (flag, options) => { calls.push(["spaces", flag, options]); win.allSpaces = flag; };
  win.moveTop = () => { calls.push(["moveTop"]); };
  return { win, calls };
}

test("Windows: top most for the shake (past the foreground lock), then a normal window again", () => {
  const { win, calls } = frontWindow();
  win.minimized = true;
  const activated = [];
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule, () => { activated.push("app"); }, "win32");
  assert.equal(nudger.nudge(win), true);
  assert.deepEqual(calls.map((call) => call[0]), ["restore", "show", "top", "moveTop", "focus"]);
  assert.deepEqual(calls.find((call) => call[0] === "top"), ["top", true, "screen-saver"]);
  assert.deepEqual(activated, ["app"]);
  assert.equal(calls.some((call) => call[0] === "spaces"), false);
  timer.flush();
  assert.equal(win.onTop, false);
  assert.deepEqual(win.bounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.equal(nudger.nudge(win), true);
});

test("macOS: a window on another Space comes to this one, then goes back to normal", () => {
  const { win, calls } = frontWindow();
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule, () => {}, "darwin");
  nudger.nudge(win);
  assert.deepEqual(calls.find((call) => call[0] === "spaces"), ["spaces", true, { skipTransformProcessType: true }]);
  assert.equal(win.onTop, true);
  timer.flush();
  assert.equal(win.allSpaces, false);
  assert.equal(win.onTop, false);
});

test("a window the person keeps on top stays on top", () => {
  const { win } = frontWindow();
  win.onTop = true;
  const timer = queuedTimer();
  createWindowNudger(timer.schedule, () => {}, "win32").nudge(win);
  timer.flush();
  assert.equal(win.onTop, true);
});

test("shake off: the window still comes to the front, and does not move", () => {
  const { win, calls } = frontWindow();
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule, () => {}, "win32");
  assert.equal(nudger.nudge(win, { shake: false }), true);
  assert.ok(calls.some((call) => call[0] === "focus"));
  assert.ok(calls.some((call) => call[0] === "top" && call[1] === true));
  timer.flush();
  assert.equal(calls.some((call) => call[0] === "bounds"), false);
  assert.equal(win.onTop, false);
});

test("a window call that throws does not leave the nudger stuck", () => {
  const { win } = frontWindow();
  win.setAlwaysOnTop = () => { throw new Error("gone"); };
  const timer = queuedTimer();
  const nudger = createWindowNudger(timer.schedule, () => { throw new Error("no focus"); }, "win32");
  assert.equal(nudger.nudge(win), true);
  timer.flush();
  assert.equal(nudger.nudge(win), true);
});
