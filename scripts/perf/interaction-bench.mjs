#!/usr/bin/env node
// Interaction bench: Sagax desktop against Grok Bot, the same interactions
// measured the same way, apps launched in alternation on the same machine.
// See docs/perf/interaction-bench.md for the method and how to read results.
//
//   node scripts/perf/interaction-bench.mjs --rounds 10 --out results.json \
//     [--apps sagax,grok] [--sagax-app PATH.app] [--fixture DIR] [--grok-profile DIR] \
//     [--scenarios startup,bot,thread,botMenu,avatar,settings,settingsPage,apps,typing,scroll,model,send]
//
// Every round launches each app fresh (startup), then runs each scenario
// twice: the first run in a process is reported as "cold", the second as
// "warm". Latency = from the input event's own timestamp (Event.timeStamp,
// set by the browser when the input arrives) to the first animation frame
// after the expected result is in the DOM, plus a task so the frame's paint
// is under way. Event Timing (INP-like) and long tasks are kept beside it.
//
// Nothing here ever sends a message or changes anything in Grok Bot: it runs
// on a throwaway copy of a Grok Bot profile, only reads, and the scenarios
// that would need a write there (send) are Sagax only. Sagax runs on a copy
// of a seeded fixture (seed-fixture.ts) with the fake engine, inside a staged
// copy of the app (stage-app.mjs), never on the installed app's data.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    rounds: { type: "string", default: "10" },
    out: { type: "string", default: "interaction-bench.json" },
    apps: { type: "string", default: "sagax,grok" },
    "sagax-app": { type: "string" },
    fixture: { type: "string" },
    "grok-app": { type: "string", default: "/Applications/Grok Bot.app" },
    "grok-profile": { type: "string" },
    scenarios: { type: "string" },
    label: { type: "string", default: "" },
    verbose: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});

const ROUNDS = Number(opts.rounds);
const APPS = opts.apps.split(",").map((s) => s.trim()).filter(Boolean);
const WORK = mkdtempSync(path.join(os.tmpdir(), "interaction-bench-"));
const WINDOW = { x: 80, y: 40, width: 1400, height: 900 };
const CHROMIUM_FLAGS = [
  // Both apps: an occluded or background window must still paint, or a busy
  // desktop (other windows on top) would throttle one app and not the other.
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-background-timer-throttling",
];
const log = (...args) => { if (opts.verbose) console.error(...args); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP ------
async function cdpJson(port, route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(2000) });
  return response.json();
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      }
    };
    ws.onerror = () => reject(new Error("CDP socket error"));
    ws.onclose = () => { for (const p of pending.values()) p.reject(new Error("CDP closed")); pending.clear(); };
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const i = ++id;
        ws.send(JSON.stringify({ id: i, method, params }));
        return new Promise((res, rej) => pending.set(i, { resolve: res, reject: rej }));
      },
      async eval(expression, timeoutMs = 15000) {
        const r = await Promise.race([
          this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
          sleep(timeoutMs).then(() => { throw new Error(`eval timed out: ${expression.slice(0, 80)}`); }),
        ]);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      close() { try { ws.close(); } catch {} },
    });
  });
}

// ------------------------------------------------------------ processes ----
function processTable() {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter(Boolean).map((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return m ? { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), command: m[4] } : null;
  }).filter(Boolean);
}

function descendants(rootPid, table = processTable()) {
  const out = [];
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    const self = table.find((p) => p.pid === pid);
    if (self) out.push(self);
    for (const child of table.filter((p) => p.ppid === pid)) queue.push(child.pid);
  }
  return out;
}

function memory(rootPid) {
  const procs = descendants(rootPid);
  const kind = (cmd) => {
    if (/--type=renderer/.test(cmd)) return "renderer";
    if (/--type=gpu-process/.test(cmd)) return "gpu";
    if (/--type=utility/.test(cmd)) return /node\.mojom|NodeService/.test(cmd) ? "nodeUtility" : "utility";
    if (/crashpad/.test(cmd)) return "other";
    return null;
  };
  const totals = { main: 0, renderer: 0, gpu: 0, utility: 0, nodeUtility: 0, child: 0, other: 0 };
  for (const p of procs) {
    const k = p.pid === rootPid ? "main" : kind(p.command) ?? "child";
    totals[k] += p.rssKb;
  }
  const mb = (kb) => Math.round(kb / 102.4) / 10;
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totalMb: mb(total), ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [`${k}Mb`, mb(v)])), processes: procs.length };
}

function killTree(rootPid) {
  const procs = descendants(rootPid);
  for (const p of procs.reverse()) { try { process.kill(p.pid, "SIGKILL"); } catch {} }
}

// ------------------------------------------------------------- in page -----
// Installed once per page. arm(cond) starts listening; the returned promise
// settles on the first frame after cond() is true following an input.
const PAGE_HELPER = String.raw`(() => {
  if (window.__bench) return true;
  const events = [];
  const longTasks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) events.push(e); }).observe({ type: "event", durationThreshold: 16, buffered: false }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e); }).observe({ type: "longtask", buffered: false }); } catch {}
  const text = (el) => (el ? el.innerText || el.textContent || "" : "");
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  window.__bench = {
    text, visible, q, qa,
    arm(condSource, timeoutMs = 10000) {
      const cond = new Function("b", "return (" + condSource + ");");
      let t0 = null;
      const kinds = ["pointerdown", "mousedown", "keydown", "contextmenu", "wheel"];
      const onInput = (e) => { if (t0 === null) t0 = e.timeStamp; };
      for (const k of kinds) window.addEventListener(k, onInput, { capture: true, passive: true });
      const startedAt = performance.now();
      const p = new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (done) return; done = true;
          mo.disconnect();
          for (const k of kinds) window.removeEventListener(k, onInput, { capture: true });
          resolve(result);
        };
        const check = () => {
          if (done || t0 === null) return;
          let ok = false;
          try { ok = !!cond(window.__bench); } catch { ok = false; }
          if (!ok) return;
          const seen = performance.now();
          requestAnimationFrame((frameTime) => {
            const raf = performance.now();
            const ch = new MessageChannel();
            ch.port1.onmessage = () => {
              const painted = performance.now();
              const ev = events.filter((e) => e.startTime >= t0 - 1);
              const lt = longTasks.filter((e) => e.startTime + e.duration >= t0);
              finish({ ok: true, latency: painted - t0, toDom: seen - t0, toFrame: raf - t0,
                eventMax: ev.reduce((m, e) => Math.max(m, e.duration), 0),
                longTaskTotal: lt.reduce((s, e) => s + e.duration, 0),
                longTaskMax: lt.reduce((m, e) => Math.max(m, e.duration), 0) });
            };
            ch.port2.postMessage(0);
          });
        };
        const mo = new MutationObserver(check);
        mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        const tick = () => { if (done) return; check(); if (performance.now() - startedAt > timeoutMs) finish({ ok: false, timeout: true, sawInput: t0 !== null }); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      window.__benchPending = p;
      return true;
    },
    // Frame pacing while something else (wheel input) drives the page.
    frames(durationMs) {
      return new Promise((resolve) => {
        const stamps = [];
        const start = performance.now();
        const lt0 = longTasks.length;
        const step = (t) => { stamps.push(t); if (t - start < durationMs) requestAnimationFrame(step); else {
          const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
          const budget = 1000 / 60;
          const dropped = gaps.reduce((s, g) => s + Math.max(0, Math.round(g / budget) - 1), 0);
          const lt = longTasks.slice(lt0);
          const sorted = [...gaps].sort((a, b) => a - b);
          resolve({ frames: stamps.length, dropped, droppedPct: dropped / (stamps.length + dropped) * 100,
            maxGap: Math.max(...gaps), p95Gap: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            longTaskTotal: lt.reduce((s, e) => s + e.duration, 0), longTaskCount: lt.length });
        } };
        requestAnimationFrame(step);
      });
    },
  };
  return true;
})()`;

// ------------------------------------------------------------- adapters ----
// Each adapter: launch(), ready condition, and per-scenario steps written as
// page conditions (strings run in the page with b = window.__bench).
const js = (value) => JSON.stringify(value);

const sagax = {
  name: "sagax",
  port: 9434,
  prepare() {
    const app = this.appPath ?? opts["sagax-app"];
    const fixture = opts.fixture;
    if (!app || !existsSync(app)) throw new Error("--sagax-app <staged Sagax.app> is required (scripts/perf/stage-app.mjs)");
    if (!fixture || !existsSync(path.join(fixture, "perf-fixture.json"))) throw new Error("--fixture <dir> from scripts/perf/seed-fixture.ts is required");
    this.app = app;
    this.fixture = fixture;
    this.meta = JSON.parse(readFileSync(path.join(fixture, "perf-fixture.json"), "utf8"));
  },
  launch(runDir) {
    const data = path.join(runDir, "data");
    const userData = path.join(runDir, "userData");
    const home = path.join(runDir, "home");
    cpSync(this.fixture, data, { recursive: true });
    if (this.master) cpSync(this.master, userData, { recursive: true });
    else mkdirSync(userData, { recursive: true });
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) rmSync(path.join(userData, f), { force: true });
    mkdirSync(home, { recursive: true });
    // Onboarding done, Advanced mode (the owner's default), a fixed window.
    const configPath = path.join(data, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.onboarding = { launchMode: "solo", completedAt: "2026-10-01T00:00:00.000Z", version: 1,
      hintsSeen: ["tour.composer", "tour.model", "tour.computer", "tour.computer-browser", "tour.tools", "tour.apps", "tour.apps-panel", "tour.automations", "tour.automations-page", "tour.done"] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    writeFileSync(path.join(userData, "window-state.json"), JSON.stringify({ bounds: WINDOW, maximized: false }));
    const exe = path.join(this.app, "Contents/MacOS/Sagax");
    return spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${this.port}`, "--use-mock-keychain", ...CHROMIUM_FLAGS], {
      env: { ...process.env, HOME: home, SAGAX_PERF_BENCH: "1", SAGAX_PERF_PORT: "18999", SAGAX_DATA_DIR: data },
      stdio: ["ignore", "ignore", "ignore"], detached: true,
    });
  },
  // Advanced mode (the owner's default) lives in localStorage.
  primeScript: `localStorage.setItem("sagax.interfaceMode.v1", "advanced"), true`,
  bootScript: "",
  pageFilter: (t) => t.url.startsWith("http://127.0.0.1:18999/"),
  ready: `b.qa("[data-sidebar-bot-row], [aria-label^='Actions for ']").length >= 5 && !!b.q("textarea, [contenteditable=true]") && !b.q("[aria-busy=true][data-chat-loading]")`,
  bots: ["Katarina", "Ember"],
  row: (name) => `span[aria-label="Rename ${name}"]`,
  botShown: (name) => `(() => { const s = b.qa("div.overflow-y-auto").find((e) => /Hello ${name}, what is on your plate/.test(b.text(e)) && e.getBoundingClientRect().left >= 250); return !!s && /${name}/.test(b.text(b.q("main") || document.body)); })()`,
  threads: { bot: "Harrie", picker: `button[aria-label="All threads"]`, a: "Second thread", aText: "Second thread question 6", b: "Hello Harrie", bText: "Hello Harrie, what is on your plate" },
  botMenu: { kind: "click", selector: (name) => `button[aria-label="Actions for ${name}"]` },
  menuOpen: `b.qa("[role=menu]").some((m) => b.visible(m) && b.qa("[role=menuitem]", m).length >= 3)`,
  avatar: `button[aria-label="You"]`,
  settingsItem: "Settings",
  settingsOpen: `(() => { const d = b.qa("[role=dialog]").find(b.visible); return !!d && /General/.test(b.text(d)) && /Appearance/.test(b.text(d)) && b.qa("button[aria-current=page]", d).length > 0; })()`,
  settingsPage: { from: "General", to: "Appearance", toText: "Sidebar density" },
  apps: `[data-sidebar-connect-apps]`,
  appsOpen: `(() => { const h = document.getElementById("plugins-title"); return !!h && b.visible(h); })()`,
  composer: `textarea, [contenteditable=true]`,
  longThread: { bot: "Harrie", open: "Long thread", text: "Please verify lot 120" },
  model: `button[aria-haspopup][aria-label*="model" i], button[aria-label*="Model" i]`,
  modelOpen: `b.qa("[role=listbox],[role=menu],[role=dialog]").some((m) => b.visible(m) && /sonnet|opus|haiku/i.test(b.text(m)))`,
  send: { bot: "Vanessa" },
};

const grok = {
  name: "grok",
  port: 9433,
  prepare() {
    this.appPath = opts["grok-app"];
    this.profile = opts["grok-profile"];
    if (!this.profile || !existsSync(this.profile)) throw new Error("--grok-profile <copy of a Grok Bot profile> is required");
  },
  launch(runDir) {
    const userData = path.join(runDir, "userData");
    execFileSync("cp", ["-cR", this.master ?? this.profile, userData]);
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) rmSync(path.join(userData, f), { force: true });
    writeFileSync(path.join(userData, "window-state.json"), JSON.stringify({ version: 1, normalBounds: WINDOW, isMaximized: false }));
    const exe = path.join(this.appPath, "Contents/MacOS/Grok Bot");
    return spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${this.port}`, ...CHROMIUM_FLAGS], {
      env: { ...process.env }, stdio: ["ignore", "ignore", "ignore"], detached: true,
    });
  },
  bootScript: "",
  pageFilter: (t) => /renderer\/index\.html/.test(t.url),
  ready: `b.qa("button[aria-label='Open account menu']").length === 1 && b.qa("button[aria-label='Katarina'],button[aria-label='Ember']").length === 2 && !!b.q("[aria-label=Prompt]") && b.qa(".ui-scroll-area__viewport").some((e) => b.text(e).length > 100)`,
  bots: ["Katarina", "Ember"],
  row: (name) => `button[aria-label="${name}"]`,
  // The row's own preview is the conversation's last message: it is on
  // screen once the conversation is rendered.
  botShown: (name) => `(() => { const row = b.q('button[aria-label="${name}"]'); const lines = b.text(row).split("\\n").map((s) => s.trim()).filter(Boolean); const preview = (lines[lines.length - 1] || "").replace(/(\\.\\.\\.|…)$/, "").slice(0, 24); const head = b.q('[aria-label="View conversation details"]'); return preview.length > 8 && /${name}/.test(b.text(head)) && b.qa(".ui-scroll-area__viewport").some((e) => e.getBoundingClientRect().left >= 250 && b.text(e).replace(/\\s+/g, " ").includes(preview.replace(/\\s+/g, " "))); })()`,
  threads: null,
  botMenu: { kind: "right", selector: (name) => `button[aria-label="${name}"]` },
  menuOpen: `b.qa("[role=menu]").some((m) => b.visible(m) && b.qa("[role=menuitem]", m).length >= 3)`,
  avatar: `button[aria-label="Open account menu"]`,
  settingsItem: "Settings",
  settingsOpen: `(() => { const d = b.qa("[role=dialog]").find(b.visible); return !!d && /General/.test(b.text(d)) && /Usage & Billing/.test(b.text(d)) && /Theme/.test(b.text(d)); })()`,
  settingsPage: { from: "General", to: "Computer", toText: null },
  apps: `button[aria-label="Connect apps"]`,
  appsOpen: `b.qa("[role=dialog]").some((d) => b.visible(d) && b.qa("button, [role=button]", d).length > 5)`,
  composer: `[aria-label=Prompt]`,
  longThread: { bot: "Harrie", open: null, text: null },
  model: null,
  send: null,
};

const ADAPTERS = { sagax, grok };
// Two Sagax builds side by side (before/after a change), each with the same
// fixture: --apps sagax:before,sagax:after,grok --sagax-app before=A.app,after=B.app
const sagaxBuilds = new Map((opts["sagax-app"] ?? "").split(",").filter((x) => x.includes("=")).map((x) => x.split("=")));
for (const [label, appPath] of sagaxBuilds) ADAPTERS[`sagax:${label}`] = { ...sagax, name: `sagax:${label}`, kind: "sagax", appPath };
sagax.kind = "sagax";
grok.kind = "grok";

// ------------------------------------------------------------- session -----
class Session {
  constructor(adapter, child, cdp) { this.a = adapter; this.child = child; this.cdp = cdp; }

  async helper() { await this.cdp.eval(PAGE_HELPER); }

  async waitFor(cond, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try { if (await this.cdp.eval(`(() => { const b = window.__bench; return !!(${cond}); })()`, 3000)) return true; } catch {}
      await sleep(40);
    }
    return false;
  }

  async center(selector) {
    return this.cdp.eval(`(() => { const e = document.querySelector(${js(selector)}); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); if (!r.width) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  }

  async centerByText(rootSelector, itemSelector, label) {
    return this.cdp.eval(`(() => { const roots = [...document.querySelectorAll(${js(rootSelector)})]; for (const root of roots) { const e = [...root.querySelectorAll(${js(itemSelector)})].find((x) => (x.innerText || "").trim() === ${js(label)} || (x.getAttribute("aria-label") || "").startsWith(${js(label)})); if (e) { const r = e.getBoundingClientRect(); if (r.width) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } } return null; })()`);
  }

  async mouse(point, button = "left") {
    if (!point) throw new Error("target not found");
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await sleep(60); // hover state settles (row action buttons show on hover)
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button, clickCount: 1 });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button, clickCount: 1 });
  }

  async key(key, { code = key, keyCode, text, modifiers = 0 } = {}) {
    await this.cdp.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text, modifiers });
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }

  async escape() { await this.key("Escape", { keyCode: 27 }); await sleep(250); }

  /** Arm, act, await the result. */
  async measure(cond, act, timeoutMs = 10000) {
    await this.helper();
    // A result already on screen would measure nothing: refuse it.
    if (await this.cdp.eval(`(() => { const b = window.__bench; try { return !!(${cond}); } catch { return false; } })()`)) {
      log(`  ! ${this.a.name}: expected result already shown before the input: ${cond.slice(0, 100)}`);
      return null;
    }
    await this.cdp.eval(`window.__bench.arm(${js(cond)}, ${timeoutMs})`);
    await act();
    const result = await this.cdp.eval(`window.__benchPending`, timeoutMs + 3000);
    if (!result?.ok) log(`  ! ${this.a.name}: no result (${JSON.stringify(result)}) for ${cond.slice(0, 100)}`);
    return result?.ok ? result : null;
  }
}

// The machine is shared: wait (bounded) for the 1-minute load to come down
// before a launch, and record what it was.
const LOAD_MAX = Number(process.env.BENCH_LOAD_MAX || Infinity);
async function waitForLoad() {
  const end = Date.now() + 180000;
  while (os.loadavg()[0] > LOAD_MAX && Date.now() < end) await sleep(5000);
}

async function launch(adapter, round) {
  if (round !== "master") await waitForLoad();
  const runDir = path.join(WORK, `${adapter.name}-${round}`);
  mkdirSync(runDir, { recursive: true });
  const load = os.loadavg();
  const t0 = Date.now();
  const child = adapter.launch(runDir);
  child.unref();
  let target = null;
  const deadline = Date.now() + 90000;
  while (!target && Date.now() < deadline) {
    try { target = (await cdpJson(adapter.port, "/json/list")).find((t) => t.type === "page" && adapter.pageFilter(t)); } catch {}
    if (!target) await sleep(25);
  }
  if (!target) { killTree(child.pid); throw new Error(`${adapter.name}: no page target`); }
  const cdp = await cdpConnect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  if (adapter.bootScript) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: adapter.bootScript });
  const session = new Session(adapter, child, cdp);
  // Interactive = the adapter's ready condition, polled every 25 ms.
  let readyAt = null;
  let pageReady = null;
  while (Date.now() < deadline) {
    try {
      const r = await cdp.eval(`(() => { ${PAGE_HELPER}; const b = window.__bench; return (${adapter.ready}) ? { now: performance.timeOrigin + performance.now(), sincePage: performance.now() } : null; })()`, 3000);
      if (r) { readyAt = r.now; pageReady = r.sincePage; break; }
    } catch {}
    await sleep(25);
  }
  if (readyAt === null) { killTree(child.pid); throw new Error(`${adapter.name}: never became interactive`); }
  if (adapter.kind === "sagax" && adapter.master) {
    const advanced = await cdp.eval(`localStorage.getItem("sagax.interfaceMode.v1")`);
    if (advanced !== "advanced") throw new Error("sagax: Advanced mode not set before first paint");
  }
  // Sagax writes each step of its start to server.log: keep where the time
  // went (relative to the spawn) beside the total.
  const phases = {};
  if (adapter.kind === "sagax") {
    try {
      for (const line of readFileSync(path.join(runDir, "userData", "logs", "server.log"), "utf8").split("\n")) {
        const m = /^\[(.+?)\] startup: (.+?) \(\+(\d+)ms\)$/.exec(line);
        if (m) phases[m[2]] = { sinceSpawn: Date.parse(m[1]) - t0, sinceMain: Number(m[3]) };
      }
    } catch {}
  }
  return { session, runDir, startup: { toInteractive: readyAt - t0, sincePageStart: pageReady, load1: load[0], phases } };
}

async function prime(adapter) {
  adapter.master = null;
  const { session, runDir } = await launch(adapter, "master");
  if (adapter.primeScript) await session.cdp.eval(adapter.primeScript);
  await sleep(5000);
  try {
    const version = await cdpJson(adapter.port, "/json/version");
    const browser = await cdpConnect(version.webSocketDebuggerUrl);
    await Promise.race([browser.send("Browser.close"), sleep(3000)]);
  } catch {}
  await sleep(3000);
  killTree(session.child.pid);
  await sleep(500);
  const dir = path.join(WORK, `${adapter.name}-master-userData`);
  cpSync(path.join(runDir, "userData"), dir, { recursive: true });
  adapter.master = dir;
  log(`${adapter.name}: primed`);
}

// ------------------------------------------------------------ scenarios ----
// A thread entry of the header's thread picker, by its title.
const pickerItem = (title, point = false) => `(() => { const e = [...document.querySelectorAll("button, [role=option], [role=menuitem]")].find((x) => (x.innerText || "").trim().startsWith(${js(title)}) && x.getBoundingClientRect().left > 700); if (!e) return ${point ? "null" : "false"}; const r = e.getBoundingClientRect(); return ${point ? "{ x: r.x + r.width / 2, y: r.y + r.height / 2 }" : "r.width > 0"}; })()`;
async function openPicker(s, title) {
  // closing animations still show the old list: wait for it to go first
  await s.waitFor(`!(${pickerItem(title)})`, 3000);
  await s.mouse(await s.center(s.a.threads.picker));
  if (!(await s.waitFor(pickerItem(title), 5000))) throw new Error(`thread picker: ${title}`);
  await sleep(300);
  const point = await s.cdp.eval(pickerItem(title, true));
  if (!point) throw new Error(`thread picker closed: ${title}`);
  return point;
}
async function pickThread(s, title) {
  await s.mouse(await openPicker(s, title));
  await sleep(300);
  if (await s.cdp.eval(pickerItem(title))) await s.escape();
}

const SCENARIOS = {
  async bot(s) {
    const [x, y] = s.a.bots;
    await s.mouse(await s.center(s.a.row(x)));
    if (!(await s.waitFor(s.a.botShown(x), 15000))) throw new Error("bot setup");
    await sleep(400);
    const r = await s.measure(s.a.botShown(y), async () => s.mouse(await s.center(s.a.row(y))));
    await sleep(300);
    return r;
  },
  async thread(s) {
    const t = s.a.threads;
    if (!t) return { na: "no threads in this app" };
    await s.mouse(await s.center(s.a.row(t.bot)));
    await sleep(600);
    const textCond = (text) => `b.qa("div.overflow-y-auto").some((e) => e.getBoundingClientRect().left >= 250 && b.text(e).includes(${js(text)}))`;
    // the header's thread picker (a read thread leaves the sidebar)
    await pickThread(s, t.b);
    if (!(await s.waitFor(textCond(t.bText), 15000))) throw new Error("thread setup");
    await sleep(400);
    const point = await openPicker(s, t.a);
    const r = await s.measure(textCond(t.aText), () => s.mouse(point));
    await sleep(300);
    return r;
  },
  async botMenu(s) {
    const [x] = s.a.bots;
    const sel = s.a.botMenu.selector(x);
    // the "…" only shows on hover: hover the row first
    await s.mouse(await s.center(s.a.row(x)));
    await sleep(300);
    const r = await s.measure(s.a.menuOpen, async () => s.mouse(await s.center(sel), s.a.botMenu.kind === "right" ? "right" : "left"));
    await s.escape();
    return r;
  },
  async avatar(s) {
    const r = await s.measure(s.a.menuOpen, async () => s.mouse(await s.center(s.a.avatar)));
    await s.escape();
    return r;
  },
  async settings(s) {
    await s.mouse(await s.center(s.a.avatar));
    if (!(await s.waitFor(s.a.menuOpen, 5000))) throw new Error("avatar menu");
    await sleep(200);
    const r = await s.measure(s.a.settingsOpen, async () => s.mouse(await s.centerByText("[role=menu]", "[role=menuitem]", s.a.settingsItem)));
    s.settingsLeftOpen = !!r;
    return r;
  },
  async settingsPage(s) {
    if (!s.settingsLeftOpen) {
      await s.mouse(await s.center(s.a.avatar));
      await s.waitFor(s.a.menuOpen, 5000);
      await sleep(200);
      await s.mouse(await s.centerByText("[role=menu]", "[role=menuitem]", s.a.settingsItem));
      if (!(await s.waitFor(s.a.settingsOpen, 10000))) throw new Error("settings setup");
    }
    const { from, to, toText } = s.a.settingsPage;
    const active = (label) => `(() => { const d = b.qa("[role=dialog]").find(b.visible); if (!d) return false; const e = b.qa("button, [role=tab]", d).find((x) => (x.innerText || "").trim() === ${js(label)}); return !!e && (e.getAttribute("aria-current") === "page" || e.getAttribute("aria-selected") === "true" || e.getAttribute("data-state") === "active" || e.getAttribute("data-active") === "true" || /active|selected/.test(e.className)); })()`;
    const shown = (label, text) => text ? `(${active(label)}) && b.text(b.qa("[role=dialog]").find(b.visible)).includes(${js(text)})` : active(label);
    // start on `from`
    await s.mouse(await s.centerByText("[role=dialog]", "button, [role=tab]", from));
    await sleep(500);
    const r = await s.measure(shown(to, toText), async () => s.mouse(await s.centerByText("[role=dialog]", "button, [role=tab]", to)));
    await s.escape();
    s.settingsLeftOpen = false;
    return r;
  },
  async apps(s) {
    const r = await s.measure(s.a.appsOpen, async () => s.mouse(await s.center(s.a.apps)));
    await s.escape();
    await sleep(300);
    // Sagax shows Connect apps in the main area: go back to a conversation.
    if (s.a.kind === "sagax" && (await s.cdp.eval(`!!document.getElementById("plugins-title")`))) {
      await s.mouse(await s.center(s.a.row(s.a.bots[0])));
      await sleep(400);
    }
    return r;
  },
  async typing(s) {
    const [x] = s.a.bots;
    await s.mouse(await s.center(s.a.row(x)));
    await s.waitFor(s.a.botShown(x), 15000);
    await sleep(300);
    await s.mouse(await s.center(s.a.composer));
    await sleep(200);
    const word = "latency check";
    const per = [];
    let typed = "";
    for (const ch of word) {
      typed += ch;
      const cond = `(() => { const c = b.q(${js(s.a.composer)}); const v = c ? (c.value ?? c.innerText ?? "") : ""; return v.replace(/\\u00a0/g, " ").includes(${js(typed)}); })()`;
      const r = await s.measure(cond, () => s.key(ch, { text: ch, code: ch === " " ? "Space" : `Key${ch.toUpperCase()}`, keyCode: ch.toUpperCase().charCodeAt(0) }), 5000);
      if (r) per.push(r);
      await sleep(70);
    }
    // clear the draft: select all, delete (never Enter)
    await s.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4, commands: ["selectAll"] });
    await s.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4 });
    await s.key("Backspace", { code: "Backspace", keyCode: 8 });
    await sleep(200);
    if (!per.length) return null;
    const sorted = per.map((r) => r.latency).sort((a, b) => a - b);
    return { latency: sorted[Math.floor(sorted.length / 2)], latencyMax: sorted[sorted.length - 1],
      eventMax: Math.max(...per.map((r) => r.eventMax)), longTaskTotal: per.reduce((t, r) => t + r.longTaskTotal, 0) };
  },
  async scroll(s) {
    const lt = s.a.longThread;
    if (s.a.kind === "sagax") {
      // a read bot folds its threads: open the bot, then the thread
      await s.mouse(await s.center(s.a.row(lt.bot)));
      await sleep(600);
      await pickThread(s, lt.open);
      if (!(await s.waitFor(`b.qa("div.overflow-y-auto").some((e) => e.getBoundingClientRect().left >= 250 && b.text(e).includes(${js(lt.text)}))`, 15000))) throw new Error("long thread");
    } else {
      await s.mouse(await s.center(s.a.row(lt.bot)));
      await s.waitFor(s.a.botShown(lt.bot), 15000);
    }
    await sleep(800);
    await s.helper();
    // the transcript: the tallest scroller right of the sidebar
    const info = await s.cdp.eval(`(() => { const all = [...document.querySelectorAll("*")].filter((e) => { const st = getComputedStyle(e); const r = e.getBoundingClientRect(); return (st.overflowY === "auto" || st.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 200 && r.left >= 250; }).sort((a, b) => b.scrollHeight - a.scrollHeight); const e = all[0]; if (!e) return null; e.scrollTop = e.scrollHeight; window.__benchScroller = e; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, scrollHeight: e.scrollHeight, nodes: e.querySelectorAll("*").length }; })()`);
    if (!info) throw new Error("no transcript scroller");
    await sleep(500);
    const framesP = s.cdp.eval(`window.__bench.frames(2600)`, 20000);
    framesP.catch(() => {}); // a window that goes away mid-scroll fails the sample, not the run
    const before = await s.cdp.eval(`window.__benchScroller.scrollTop`);
    for (let i = 0; i < 120; i++) {
      await s.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: info.x, y: info.y, deltaX: 0, deltaY: -120 });
      await sleep(16);
    }
    const frames = await framesP;
    const after = await s.cdp.eval(`window.__benchScroller.scrollTop`);
    return { latency: frames.p95Gap, ...frames, scrolledPx: Math.round(before - after), scrollHeight: info.scrollHeight, transcriptNodes: info.nodes };
  },
  async model(s) {
    if (!s.a.model) return { na: "no model picker in this app" };
    const [x] = s.a.bots;
    await s.mouse(await s.center(s.a.row(x)));
    await s.waitFor(s.a.botShown(x), 15000);
    await sleep(300);
    const point = await s.cdp.eval(`(() => { const c = document.querySelector(${js(s.a.composer)}); const form = c && c.closest("form, [data-composer], .composer") || c?.parentElement?.parentElement?.parentElement; const btn = [...document.querySelectorAll("button")].find((e) => /sonnet|opus|haiku/i.test(e.innerText || "") && e.getBoundingClientRect().top > window.innerHeight - 160); if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const r = await s.measure(s.a.modelOpen, async () => s.mouse(point));
    await s.escape();
    return r;
  },
  async send(s) {
    if (!s.a.send) return { na: "not measured: it would send a real message" };
    const bot = s.a.send.bot;
    await s.mouse(await s.center(s.a.row(bot)));
    await sleep(800);
    await s.mouse(await s.center(s.a.composer));
    await sleep(150);
    const text = `bench ${Date.now().toString(36)}`;
    await s.cdp.send("Input.insertText", { text });
    await sleep(300);
    const cond = `b.qa("div.overflow-y-auto").some((e) => e.getBoundingClientRect().left >= 250 && b.text(e).includes(${js(text)}))`;
    const r = await s.measure(cond, () => s.key("Enter", { code: "Enter", keyCode: 13, text: "\r" }));
    await sleep(2500); // the fake engine answers; let it settle
    return r;
  },
};

// A promise left pending by a page that went away must not end the run.
process.on("unhandledRejection", (error) => log(`  ! unhandled: ${error instanceof Error ? error.message : String(error)}`));

const ORDER = ["bot", "thread", "botMenu", "avatar", "settings", "settingsPage", "apps", "typing", "model", "send", "scroll"];
const wanted = opts.scenarios ? opts.scenarios.split(",") : ["startup", ...ORDER];

// ------------------------------------------------------------------ run ----
const results = { label: opts.label, startedAt: new Date().toISOString(), host: { cpus: os.cpus().length, model: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 2 ** 30) }, rounds: ROUNDS, apps: {} };
for (const name of APPS) { ADAPTERS[name].prepare(); results.apps[name] = { startup: [], memoryIdle: [], memoryAfter: [], cold: {}, warm: {}, na: {} }; }
// One unmeasured launch per app first: what a second launch finds (code
// caches, the HTTP cache, the version an app stamps on its first run) is then
// the same for both, as on a computer where both are in daily use.
for (const name of APPS) await prime(ADAPTERS[name]);

for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 === 0 ? APPS : [...APPS].reverse();
  for (const name of order) {
    const adapter = ADAPTERS[name];
    const bucket = results.apps[name];
    let session;
    try {
      const launched = await launch(adapter, round);
      session = launched.session;
      bucket.startup.push(launched.startup);
      log(`[${round}] ${name} interactive in ${Math.round(launched.startup.toInteractive)} ms (load ${launched.startup.load1.toFixed(1)})`);
      await sleep(5000);
      bucket.memoryIdle.push(memory(session.child.pid));
      for (const pass of ["cold", "warm"]) {
        for (const scenario of ORDER) {
          if (!wanted.includes(scenario)) continue;
          let r = null;
          try { r = await SCENARIOS[scenario](session); } catch (error) { log(`  ! ${name} ${scenario}: ${opts.verbose ? error.stack : error.message}`); try { await session.escape(); } catch {} }
          if (r?.na) { bucket.na[scenario] = r.na; continue; }
          (bucket[pass][scenario] ??= []).push(r ? { ...r, load1: os.loadavg()[0] } : null);
          log(`  ${name} ${pass} ${scenario}: ${r ? Math.round(r.latency) + " ms" : "failed"}`);
        }
      }
      bucket.memoryAfter.push(memory(session.child.pid));
    } catch (error) {
      console.error(`[${round}] ${name}: ${error.message}`);
    } finally {
      if (session) { session.cdp.close(); killTree(session.child.pid); }
      await sleep(1500);
    }
  }
  writeFileSync(opts.out, JSON.stringify(results, null, 2));
}

// --------------------------------------------------------------- summary ---
const stats = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  return { n: v.length, median: Math.round(at(0.5) * 10) / 10, p95: Math.round(at(0.95) * 10) / 10 };
};
const summary = {};
for (const [name, bucket] of Object.entries(results.apps)) {
  summary[name] = {
    startup: stats(bucket.startup.map((s) => s.toInteractive)),
    memoryIdleMb: stats(bucket.memoryIdle.map((m) => m.totalMb)),
    memoryAfterMb: stats(bucket.memoryAfter.map((m) => m.totalMb)),
    rendererIdleMb: stats(bucket.memoryIdle.map((m) => m.rendererMb)),
    mainIdleMb: stats(bucket.memoryIdle.map((m) => m.mainMb)),
    load1: stats(bucket.startup.map((s) => s.load1)),
  };
  for (const pass of ["cold", "warm"]) {
    for (const [scenario, runs] of Object.entries(bucket[pass])) {
      summary[name][`${scenario}.${pass}`] = { ...stats(runs.map((r) => r?.latency)), failed: runs.filter((r) => !r).length,
        eventMax: stats(runs.map((r) => r?.eventMax)), longTask: stats(runs.map((r) => r?.longTaskTotal)),
        ...(scenario === "scroll" ? { droppedPct: stats(runs.map((r) => r?.droppedPct)), maxGap: stats(runs.map((r) => r?.maxGap)) } : {}) };
    }
  }
  summary[name].na = bucket.na;
}
results.summary = summary;
results.finishedAt = new Date().toISOString();
writeFileSync(opts.out, JSON.stringify(results, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (!opts.keep) rmSync(WORK, { recursive: true, force: true });
