// Electron side of scripts/verify-owl3d.mjs. Opens transparent, frameless windows
// like the desktop mascot's and saves what they draw:
//  - the stage page (scripts/verify-owl3d/) for set activities and facings;
//  - the real floating bot page (?omb-floating-bot=1) through the real preload,
//    fed a snapshot of a bot whose owl is set to 3D, sampled while it lives.
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const origin = process.env.VERIFY_ORIGIN;
const out = process.env.VERIFY_OUT;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCENES = [
  { name: "idle-right", activity: "idle", face: 1 },
  { name: "idle-left", activity: "idle", face: -1 },
  { name: "walk-right", activity: "walk", face: 1, at: [700, 850, 1000] },
  { name: "walk-left", activity: "walk", face: -1, at: [700, 850] },
  { name: "fly-right", activity: "fly", face: 1, at: [700, 820] },
  { name: "fly-left", activity: "fly", face: -1, at: [700, 820] },
  { name: "turn", activity: "idle", face: 1, flip: 900, at: [950, 1050, 1150, 1500] },
  { name: "wave-purple", activity: "wave", face: 1, color: "purple", at: [900] },
  { name: "celebrate-gold", activity: "celebrate", face: 1, skin: "gold", at: [800, 1300] },
  { name: "sleep-white-frost", activity: "sleep", face: 1, color: "white", skin: "frost", at: [1200] },
  { name: "neon-blue", activity: "dance", face: -1, color: "blue", skin: "neon", at: [1500] },
];

/** Vite optimizes dependencies on a first visit and reloads the page: retry. */
async function load(win, url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await win.loadURL(url);
      await wait(400);
      if (await win.webContents.executeJavaScript("Boolean(document.getElementById('root')?.children.length)")) return;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
    await wait(1500);
  }
}

async function scene(s) {
  const win = new BrowserWindow({ width: 300, height: 300, show: true, frame: false, transparent: true, hasShadow: false, webPreferences: { sandbox: true } });
  const q = new URLSearchParams({ activity: s.activity, face: String(s.face), color: s.color ?? "green", skin: s.skin ?? "none", flip: String(s.flip ?? 0), bg: "#eef0f3" });
  await load(win, `${origin}/scripts/verify-owl3d/index.html?${q}`);
  const stage = await win.webContents.executeJavaScript("window.owlStage");
  win.setContentSize(Math.ceil(stage.width), Math.ceil(stage.height));
  const start = Date.now();
  const shots = [];
  for (const at of s.at ?? [1500]) {
    await wait(Math.max(0, at - (Date.now() - start)));
    const image = await win.webContents.capturePage();
    const file = path.join(out, `${s.name}-${at}.png`);
    fs.writeFileSync(file, image.toPNG());
    shots.push(file);
  }
  const title = win.getTitle();
  win.destroy();
  if (title === "owl3d-failed") throw new Error(`${s.name}: the 3D owl failed to load`);
  return shots;
}

async function liveWindow() {
  // the real floating page, its real preload, and a stand-in for main's side of the protocol
  const work = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: 320, height: 320, x: work.x + Math.round(work.width / 2), y: work.y + work.height - 360,
    show: true, frame: false, transparent: true, hasShadow: false, resizable: false,
    webPreferences: { preload: path.join(__dirname, "..", "electron", "floating-bot-preload.cjs"), sandbox: true, contextIsolation: true },
  });
  let task = "idle";
  const snapshot = () => ({
    v: 1, name: "Sagax", label: "Sagax", color: "green", skin: "none", avatar: null, pose: "idle", reduced: false, retro: false, sparkle: 0,
    locale: "en", menu: [], balloon: null, task, mood: 0.9, flyAway: true, hints: { mood: "", working: "" }, liveliness: "lively",
    mascot: { character: "owl", style: "3d" },
  });
  const send = () => !win.isDestroyed() && win.webContents.send("floating-bot:state", snapshot());
  ipcMain.on("floating-bots:ready", send);
  ipcMain.handle("floating-bots:geometry", () => ({ bounds: win.getBounds(), workArea: work, cursor: screen.getCursorScreenPoint() }));
  ipcMain.handle("floating-bots:move-to", (_e, { x, y }) => {
    win.setPosition(Math.round(x), Math.round(y));
    return win.getBounds();
  });
  ipcMain.handle("floating-bots:move-by", (_e, { dx, dy }) => {
    const b = win.getBounds();
    win.setPosition(Math.round(b.x + dx), Math.round(b.y + dy));
    return { x: b.x + dx, y: b.y + dy };
  });
  ipcMain.handle("floating-bots:resize", (_e, { width, height }) => {
    win.setContentSize(Math.max(80, Math.ceil(width)), Math.max(80, Math.ceil(height)));
    return win.getBounds();
  });
  for (const channel of ["floating-bots:moved", "floating-bots:autopilot", "floating-bots:set-interactive", "floating-bots:set-focusable", "floating-bots:event"]) ipcMain.on(channel, () => undefined);
  const errors = [];
  win.webContents.on("console-message", (event) => {
    const message = event.message ?? "";
    if (/error|failed/i.test(message)) errors.push(message);
  });
  await load(win, `${origin}/?omb-floating-bot=1`);
  const log = [];
  for (let i = 0; i < 40; i += 1) {
    await wait(500);
    if (i === 18) {
      // a task with "fly away" on: it takes off for the screen's edge
      task = "working";
      send();
    }
    if (i === 30) {
      task = "idle";
      send();
    }
    const has3d = await win.webContents.executeJavaScript("Boolean(document.querySelector('.fb-canvas'))");
    const b = win.getBounds();
    log.push({ t: i * 0.5, x: b.x, y: b.y, canvas: has3d });
    if (i % 2 === 1) fs.writeFileSync(path.join(out, `live-${String(i).padStart(2, "0")}.png`), (await win.webContents.capturePage()).toPNG());
  }
  win.destroy();
  return { log, errors };
}

// windows open and close one after another: closing the last one must not quit
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  try {
    const shots = [];
    await scene({ name: "warmup", activity: "idle", face: 1, at: [3000] });
    for (const s of SCENES) shots.push(...(await scene(s)));
    const live = await liveWindow();
    fs.writeFileSync(path.join(out, "live-log.json"), JSON.stringify(live, null, 1));
    console.log(`[verify-owl3d] ${shots.length} stage shots, live window: canvas ${live.log.filter((l) => l.canvas).length}/${live.log.length}, errors ${live.errors.length}`);
    app.exit(live.log.some((l) => l.canvas) ? 0 : 1);
  } catch (error) {
    console.error(`[verify-owl3d] ${error?.stack ?? error}`);
    app.exit(1);
  }
});
