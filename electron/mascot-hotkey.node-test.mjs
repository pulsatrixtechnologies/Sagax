import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createMascotHotkey,
  createModifierProbe,
  DEFAULT_HOTKEY,
  HOLD_MAX_MS,
  HOLD_MS,
  modifierMask,
  PROBE_WAIT_MS,
  probeScript,
  sanitizeHotkeyConfig,
} from "./mascot-hotkey.mjs";

/** globalShortcut as Electron keeps it: one callback per accelerator, a second register of the same one refused. */
function fakeShortcut({ taken = [] } = {}) {
  const held = new Map();
  const calls = { register: 0, unregister: 0 };
  return {
    calls,
    held,
    register(accelerator, callback) {
      calls.register += 1;
      if (held.has(accelerator) || taken.includes(accelerator)) return false;
      held.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      calls.unregister += 1;
      held.delete(accelerator);
    },
    isRegistered: (accelerator) => held.has(accelerator),
    press(accelerator = DEFAULT_HOTKEY) {
      held.get(accelerator)?.();
    },
  };
}

/** A clock and timers the test moves by hand. */
function fakeClock() {
  let at = 0;
  let next = 1;
  const timers = new Map();
  return {
    now: () => at,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, due: at + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const until = at + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        timers.delete(due[0]);
        at = due[1].due;
        due[1].fn();
      }
      at = until;
    },
  };
}

/** A probe the test drives: it records the accelerator and hands back the reading callback. */
function fakeProbe() {
  const runs = [];
  const probe = (accelerator, onChange) => {
    const run = { accelerator, onChange, stopped: false, stop() { run.stopped = true; } };
    runs.push(run);
    return run;
  };
  return { probe, runs };
}

function setup({ probe = null, taken } = {}) {
  const shortcut = fakeShortcut({ taken });
  const clock = fakeClock();
  const heard = [];
  const logs = [];
  const hotkey = createMascotHotkey({ globalShortcut: shortcut, notify: (kind) => heard.push(kind), probe, log: (line) => logs.push(line), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  return { shortcut, clock, heard, logs, hotkey };
}

test("sanitizeHotkeyConfig keeps only known accelerators and booleans", () => {
  assert.deepEqual(sanitizeHotkeyConfig(null), { enabled: false, accelerator: DEFAULT_HOTKEY, hold: false });
  assert.deepEqual(sanitizeHotkeyConfig({ enabled: true, accelerator: "Control+Shift+Space", hold: true }), { enabled: true, accelerator: "Control+Shift+Space", hold: true });
  assert.deepEqual(sanitizeHotkeyConfig({ enabled: "yes", accelerator: "Command+Q", hold: 1 }), { enabled: false, accelerator: DEFAULT_HOTKEY, hold: false });
});

test("registers once on enable, never twice for the same accelerator", () => {
  const { shortcut, hotkey } = setup();
  assert.deepEqual(hotkey.configure({ enabled: true }), { registered: DEFAULT_HOTKEY, conflict: false });
  hotkey.configure({ enabled: true });
  hotkey.configure({ enabled: true, hold: true });
  assert.equal(shortcut.calls.register, 1);
  assert.equal(shortcut.held.size, 1);
  assert.equal(hotkey.registered, DEFAULT_HOTKEY);
});

test("a new accelerator replaces the old one", () => {
  const { shortcut, hotkey } = setup();
  hotkey.configure({ enabled: true });
  hotkey.configure({ enabled: true, accelerator: "Alt+Shift+Space" });
  assert.deepEqual([...shortcut.held.keys()], ["Alt+Shift+Space"]);
  assert.equal(hotkey.registered, "Alt+Shift+Space");
});

test("disabled, hidden or disposed: the key is released", () => {
  const { shortcut, hotkey } = setup();
  hotkey.configure({ enabled: true });
  hotkey.configure({ enabled: false });
  assert.equal(shortcut.held.size, 0);
  assert.equal(hotkey.registered, null);
  hotkey.configure({ enabled: true });
  hotkey.disable();
  assert.equal(shortcut.held.size, 0);
  hotkey.configure({ enabled: true });
  hotkey.dispose();
  assert.equal(shortcut.held.size, 0);
  // releasing twice is harmless
  hotkey.dispose();
  assert.equal(hotkey.registered, null);
});

test("an accelerator another app holds is reported, not retried in a loop", () => {
  const { hotkey, logs } = setup({ taken: [DEFAULT_HOTKEY] });
  assert.deepEqual(hotkey.configure({ enabled: true }), { registered: null, conflict: true });
  assert.equal(hotkey.registered, null);
  assert.match(logs[0], /taken by another app/);
});

test("without a hold asked, every press is a tap at once", () => {
  const { probe } = fakeProbe();
  const { shortcut, hotkey, heard } = setup({ probe });
  hotkey.configure({ enabled: true });
  shortcut.press();
  shortcut.press();
  assert.deepEqual(heard, ["tap", "tap"]);
});

test("no probe on this platform: a press is a tap even when a hold is asked", () => {
  const { shortcut, hotkey, heard } = setup({ probe: null });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  assert.deepEqual(heard, ["tap"]);
});

test("hold asked: a quick press is a tap, the probe stops", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  assert.equal(hotkey.pressing, "deciding");
  clock.advance(120);
  runs[0].onChange(false);
  assert.deepEqual(heard, ["tap"]);
  assert.equal(runs[0].stopped, true);
  assert.equal(hotkey.pressing, null);
});

test("hold asked: held past HOLD_MS is a hold, the release ends it", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  runs[0].onChange(true);
  clock.advance(HOLD_MS - 1);
  assert.deepEqual(heard, []);
  clock.advance(1);
  assert.deepEqual(heard, ["hold"]);
  // key repeats while held are the same press
  shortcut.press();
  assert.equal(runs.length, 1);
  clock.advance(2000);
  runs[0].onChange(false);
  assert.deepEqual(heard, ["hold", "release"]);
  assert.equal(runs[0].stopped, true);
});

test("a slow probe: its first reading after HOLD_MS decides", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  clock.advance(HOLD_MS + 100);
  assert.deepEqual(heard, []);
  runs[0].onChange(true);
  assert.deepEqual(heard, ["hold"]);
  runs[0].onChange(false);
  assert.deepEqual(heard, ["hold", "release"]);
});

test("a probe that never answers: a tap after PROBE_WAIT_MS", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  clock.advance(PROBE_WAIT_MS);
  assert.deepEqual(heard, ["tap"]);
  assert.equal(runs[0].stopped, true);
});

test("a hold that never ends is released after HOLD_MAX_MS", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  runs[0].onChange(true);
  clock.advance(HOLD_MS);
  clock.advance(HOLD_MAX_MS);
  assert.deepEqual(heard, ["hold", "release"]);
});

test("hidden mid-hold: the talk is released with the key", () => {
  const { probe, runs } = fakeProbe();
  const { shortcut, hotkey, heard, clock } = setup({ probe });
  hotkey.configure({ enabled: true, hold: true });
  shortcut.press();
  runs[0].onChange(true);
  clock.advance(HOLD_MS);
  hotkey.disable();
  assert.deepEqual(heard, ["hold", "release"]);
  assert.equal(shortcut.held.size, 0);
  assert.equal(runs[0].stopped, true);
});

test("modifierMask reads the chord's modifiers (NSEvent flags)", () => {
  assert.equal(modifierMask("Control+Alt+Space"), (1 << 18) | (1 << 19));
  assert.equal(modifierMask("Control+Shift+Space"), (1 << 18) | (1 << 17));
  assert.equal(modifierMask("Space"), 0);
  assert.match(probeScript(modifierMask(DEFAULT_HOTKEY)), /var mask = 786432;/);
});

test("the macOS probe spawns osascript and reports its readings; none elsewhere", () => {
  assert.equal(createModifierProbe({ platform: "win32" }), null);
  assert.equal(createModifierProbe({ platform: "linux" }), null);
  const spawned = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    spawned.push({ command, args, child });
    return child;
  };
  const probe = createModifierProbe({ platform: "darwin", spawn });
  const readings = [];
  const run = probe(DEFAULT_HOTKEY, (down) => readings.push(down));
  assert.equal(spawned[0].command, "/usr/bin/osascript");
  assert.deepEqual(spawned[0].args.slice(0, 3), ["-l", "JavaScript", "-e"]);
  spawned[0].child.stderr.emit("data", "1\n");
  spawned[0].child.stderr.emit("data", "0");
  spawned[0].child.stderr.emit("data", "\n");
  assert.deepEqual(readings, [true, false]);
  run.stop();
  assert.equal(spawned[0].child.killed, true);
  // a chord without a modifier cannot be read
  assert.equal(probe("Space", () => undefined), null);
});
