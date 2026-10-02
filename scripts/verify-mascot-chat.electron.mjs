// Electron side of scripts/verify-mascot-chat.mjs. Runs the real floating bot
// controller with a stand-in for the app page (the brain), opens one mascot
// and measures, in its real window:
//  - open: from the snapshot with a balloon to the balloon drawn, and to the
//    window's last resize for it (median of several close and reopen);
//  - stream: a reply streamed in 30 ms steps under three earlier exchanges;
//  - drag: the mascot dragged with the balloon open (synthetic pointer);
//  - resize: the balloon's grip dragged;
// counting window setBounds calls, position writes, dropped frames (rAF gaps)
// and long tasks; then the balloon's background under two skins and Trombi.
import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFloatingBotWindows } from "../electron/floating-bot-window.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = process.env.VERIFY_ORIGIN;
const out = process.env.VERIFY_OUT;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const BOT = "bot-verify";

const counters = { setBounds: 0, setPosition: 0, writes: 0, lastBoundsAt: 0 };
class CountedWindow extends BrowserWindow {
  setBounds(...args) {
    counters.setBounds += 1;
    counters.lastBoundsAt = Date.now();
    return super.setBounds(...args);
  }
  setPosition(...args) {
    counters.setPosition += 1;
    counters.lastBoundsAt = Date.now();
    return super.setPosition(...args);
  }
}

// the brain: a stand-in main window whose page "sends" through ipcMain directly
const brainEvents = [];
const brain = { isDestroyed: () => false, send: (channel, payload) => brainEvents.push({ channel, payload }) };
const mainWindow = { isDestroyed: () => false, webContents: brain };

const PARAGRAPH = "The **mascot** answers here, with `code`, a [link](https://example.com) and a list:\n\n- one point\n- another point that runs a little longer than the first\n\n";
const history = Array.from({ length: 3 }, (_, i) => ({ asked: `Earlier question ${i + 1}?`, text: PARAGRAPH.repeat(4) }));

// a premium skin with live effects: the heaviest look to chat over
const LOOK = { character: "shape", shape: "star", skins: { shape: "holo" } };

function snapshot({ balloon = null, text = "", streaming = false, theme, mascot = LOOK } = {}) {
  return {
    v: 1, id: BOT, name: "Sagax", label: "Sagax", color: "green", skin: "none", avatar: null, pose: streaming ? "speak" : "idle",
    reduced: false, retro: false, sparkle: 0, locale: "en", menu: [{ id: "open", label: "Open in the app" }],
    task: "idle", mood: 0.8, flyAway: false, hints: { mood: "", working: "", pin: "Put back" }, liveliness: "normal",
    mascot,
    ...(theme ? { theme } : {}),
    balloon: balloon
      ? { kind: "chat", title: "Sagax", asked: "Tell me something long", text, history, streaming, truncated: false, open: "Open in Sagax", close: "Close",
          input: { label: "Message", placeholder: "Ask Sagax", send: "Send" } }
      : null,
  };
}
const update = (snap) => ipcMain.emit("floating-bots:update", { sender: brain }, { botId: BOT, snapshot: snap });

const MONITOR = `(() => {
  if (window.__fm) return true;
  const fm = window.__fm = { last: 0, gaps: [], long: 0, longMs: 0, on: false, shownAt: 0, clipped: 0, jumps: 0, anchor: null, still: true };
  const loop = (t) => {
    if (fm.on && fm.last) {
      fm.gaps.push(t - fm.last);
      // a frame drawn with the content cut by a window that has not caught up
      const root = document.querySelector(".fb-root");
      if (root && (root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1)) fm.clipped += 1;
      // the character's corner on the screen: it must not move unless dragged
      const stage = document.querySelector(".fb-stage")?.getBoundingClientRect();
      if (stage && fm.still) {
        const at = Math.round(screenX + stage.right) + "," + Math.round(screenY + stage.bottom);
        if (fm.anchor && fm.anchor !== at) fm.jumps += 1;
        fm.anchor = at;
      }
    }
    fm.last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((list) => { if (!fm.on) return; for (const e of list.getEntries()) { fm.long += 1; fm.longMs += e.duration; } }).observe({ entryTypes: ["longtask"] });
  } catch {}
  const shown = () => { const b = document.querySelector(".fb-balloon"); return Boolean(b && !b.closest("[hidden]") && b.getBoundingClientRect().height > 0); };
  new MutationObserver(() => {
    if (shown()) { if (!fm.shownAt) requestAnimationFrame(() => { fm.shownAt = fm.shownAt || Date.now(); }); }
    else fm.shownAt = 0;
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  return true;
})()`;

const js = (win, code) => win.webContents.executeJavaScript(code);
const startFrames = (win, still = true) => js(win, `(() => { const fm = window.__fm; fm.gaps = []; fm.long = 0; fm.longMs = 0; fm.last = 0; fm.clipped = 0; fm.jumps = 0; fm.anchor = null; fm.still = ${still}; fm.on = true; return true; })()`);
async function stopFrames(win) {
  const r = await js(win, "(() => { const fm = window.__fm; fm.on = false; return { gaps: fm.gaps, long: fm.long, longMs: fm.longMs, clipped: fm.clipped, jumps: fm.jumps }; })()");
  const gaps = r.gaps.slice().sort((a, b) => a - b);
  const frame = 1000 / 60;
  const dropped = r.gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / frame) - 1), 0);
  const expected = r.gaps.reduce((sum, gap) => sum + gap, 0) / frame;
  return {
    frames: r.gaps.length,
    dropped,
    droppedPct: expected ? Math.round((dropped / expected) * 1000) / 10 : 0,
    worstMs: Math.round(gaps.at(-1) ?? 0),
    p95Ms: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
    clippedFrames: r.clipped,
    ...(r.jumps ? { anchorJumps: r.jumps } : {}),
    longTasks: r.long,
    longTaskMs: Math.round(r.longMs),
  };
}
/** CPU use since the last call, %, of the floating window's renderer, the main process and the GPU process. */
function cpu(win) {
  const pid = win.webContents.getOSProcessId();
  const metrics = app.getAppMetrics();
  const of = (match) => Math.round(metrics.filter(match).reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0));
  return { rendererCpu: of((m) => m.pid === pid), mainCpu: of((m) => m.type === "Browser"), gpuCpu: of((m) => m.type === "GPU") };
}
const resetCounters = () => Object.assign(counters, { setBounds: 0, setPosition: 0, writes: 0 });
const moves = () => counters.setBounds + counters.setPosition;

async function waitFor(win, code, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await js(win, code)) return true;
    } catch {
      /* page reloading */
    }
    await wait(50);
  }
  return false;
}

async function measureOpen(win) {
  update(snapshot());
  await wait(400);
  resetCounters();
  await js(win, "window.__fm.shownAt = 0, true");
  const sent = Date.now();
  update(snapshot({ balloon: true, text: PARAGRAPH }));
  await waitFor(win, "Boolean(window.__fm.shownAt)", 4000);
  await wait(600);
  const shownAt = await js(win, "window.__fm.shownAt");
  return { shownMs: shownAt - sent, settledMs: Math.max(shownAt, counters.lastBoundsAt) - sent, windowMoves: moves() };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A pointer drag on an element of the page, in screen space, over `steps` frames. */
async function drag(win, selector, dx, dy, steps) {
  const rect = await js(win, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const start = win.getBounds();
  const sx = start.x + rect.x;
  const sy = start.y + rect.y;
  const at = (gx, gy) => {
    const b = win.getBounds();
    return { x: Math.round(gx - b.x), y: Math.round(gy - b.y), globalX: Math.round(gx), globalY: Math.round(gy) };
  };
  win.webContents.sendInputEvent({ type: "mouseMove", ...at(sx, sy) });
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...at(sx, sy) });
  let lag = 0;
  for (let i = 1; i <= steps; i += 1) {
    await wait(16);
    const gx = sx + (dx * i) / steps;
    const gy = sy + (dy * i) / steps;
    win.webContents.sendInputEvent({ type: "mouseMove", button: "left", ...at(gx, gy) });
    // where the dragged thing is drawn now, on the screen, against the pointer
    const now = await js(win, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const b = win.getBounds();
    lag += Math.hypot(b.x + now.x - gx, b.y + now.y - gy);
  }
  await wait(50);
  const end = at(sx + dx, sy + dy);
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...end });
  await wait(300);
  return { meanLagPx: Math.round(lag / steps), moved: { x: win.getBounds().x - start.x, y: win.getBounds().y - start.y } };
}

async function faceColors(win) {
  return js(win, `(() => {
    const face = document.querySelector(".fb-balloon-face");
    const s = face ? getComputedStyle(face) : null;
    return { skin: document.documentElement.dataset.skin ?? null, background: s?.backgroundColor ?? null, color: s?.color ?? null, retro: Boolean(document.querySelector(".r98-balloon")) };
  })()`);
}

app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  const report = { electron: process.versions.electron, platform: process.platform };
  try {
    const floats = createFloatingBotWindows({
      BrowserWindow: CountedWindow,
      screen,
      ipcMain,
      getMainWindow: () => mainWindow,
      pageUrl: () => `${origin}/?omb-floating-bot=1`,
      preload: path.join(here, "..", "electron", "floating-bot-preload.cjs"),
      readPositions: () => ({}),
      writePositions: () => {
        counters.writes += 1;
      },
      focusMain: () => undefined,
      log: (line) => console.log(`[mascot-chat] ${line}`),
    });
    const t0 = Date.now();
    const win = floats.open(BOT);
    update(snapshot());
    // Vite optimizes dependencies on a first visit and may reload the page
    if (!(await waitFor(win, "Boolean(document.querySelector('.fb-art'))", 60000))) throw new Error("the mascot never drew");
    report.firstDrawMs = Date.now() - t0;
    await wait(1500);
    await js(win, MONITOR);

    // open latency: close and reopen a few times
    const opens = [];
    for (let i = 0; i < 5; i += 1) opens.push(await measureOpen(win));
    report.open = {
      shownMs: median(opens.map((o) => o.shownMs)),
      settledMs: median(opens.map((o) => o.settledMs)),
      windowMoves: median(opens.map((o) => o.windowMoves)),
      all: opens,
    };

    // the balloon open, nothing happening: what the mascot costs behind the chat
    update(snapshot({ balloon: true, text: PARAGRAPH }));
    await wait(500);
    cpu(win);
    await startFrames(win);
    await wait(3000);
    report.idleOpen = { ...cpu(win), ...(await stopFrames(win)) };

    // a reply streams in
    update(snapshot({ balloon: true, text: "", streaming: true }));
    await wait(500);
    resetCounters();
    cpu(win);
    await startFrames(win);
    let text = "";
    const stream = PARAGRAPH.repeat(6);
    const started = Date.now();
    for (let i = 0; i < 160; i += 1) {
      text = stream.slice(0, Math.round(((i + 1) / 160) * stream.length));
      update(snapshot({ balloon: true, text, streaming: true }));
      await wait(30);
    }
    update(snapshot({ balloon: true, text, streaming: false }));
    await wait(300);
    report.stream = { updates: 161, ms: Date.now() - started, windowMoves: moves(), ...cpu(win), ...(await stopFrames(win)) };

    // drag the mascot with the balloon open
    resetCounters();
    cpu(win);
    await startFrames(win, false);
    const dragged = await drag(win, ".fb-body", -220, -120, 90);
    report.drag = { steps: 90, windowMoves: moves(), positionWrites: counters.writes, ...dragged, ...cpu(win), ...(await stopFrames(win)) };

    // resize the balloon from its grip
    resetCounters();
    cpu(win);
    await startFrames(win);
    const resized = await drag(win, ".fb-grip", -140, -90, 60);
    report.resize = { steps: 60, windowMoves: moves(), positionWrites: counters.writes, ...resized, ...cpu(win), ...(await stopFrames(win)) };
    report.events = brainEvents.filter((e) => e.channel === "floating-bots:event").map((e) => e.payload.event.type);

    // theme: the app's skin, live, and Trombi's own look
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "pulsatrix-light" } }));
    await wait(400);
    const light = await faceColors(win);
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "midnight" } }));
    await wait(400);
    const dark = await faceColors(win);
    update(snapshot({ balloon: true, text: PARAGRAPH, theme: { skin: "pulsatrix-light" }, mascot: { character: "trombi" } }));
    await wait(600);
    const trombi = await faceColors(win);
    report.theme = { light, dark, trombi };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(out), "mascot-chat.png"), (await win.webContents.capturePage()).toPNG());
    floats.dispose();
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    app.exit(0);
  } catch (error) {
    console.error(`[mascot-chat] ${error?.stack ?? error}`);
    fs.writeFileSync(out, JSON.stringify({ ...report, error: String(error?.message ?? error) }, null, 1));
    app.exit(1);
  }
});
