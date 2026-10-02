// Electron side of scripts/verify-org-computer.ts: signs in to the local
// organization server through its web sign-in, opens a bot, and checks the
// Computer tab (live server environment desktop, Take control in the middle,
// Release control, usage), the bot's Works on (Cloud present whatever the
// VPS and Boat flags say) and the composer's place menu. Screenshots go to
// VERIFY_SHOTS.
import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";

const origin = process.env.VERIFY_ORIGIN;
const shots = process.env.VERIFY_SHOTS;
const log = (line) => console.log(`[org-computer] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, predicate, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate().catch(() => null);
    if (value) return value;
    await wait(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1360, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const image = await win.webContents.capturePage();
    writeFileSync(path.join(shots, name), image.toPNG());
    log(`screenshot ${name}`);
  };
  /** Click the first element matching a selector whose text or label matches. */
  const click = (selector, text) => js(`(() => {
    const re = new RegExp(${JSON.stringify(text)});
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => re.test(node.getAttribute("aria-label") ?? "") || re.test(node.textContent ?? ""));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  })()`);
  const text = () => js("document.body.innerText");

  try {
    // Web sign-in with the fake Perspicax: start, authorize, callback, home.
    await win.loadURL(`${origin}/auth/oidc/start`);
    await until("the session", async () => (await js("fetch('/api/auth/session').then(r => r.json())"))?.identity === "perspicax");
    if (new URL(win.webContents.getURL()).pathname !== "/") await win.loadURL(`${origin}/`);
    await js(`localStorage.setItem("omb-language", "en")`);
    // A bot of Ada's, on Auto.
    const bot = await js(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Luna" }) }).then(r => r.json()).then(b => b.bot)`);
    check("created a bot", Boolean(bot?.id));
    await win.loadURL(`${origin}/`);
    await until("the app", async () => (await js(`(document.getElementById("root")?.childElementCount ?? 0) > 0`)));
    await wait(2500);
    // Skip the welcome tour.
    await click("button", "^Skip tour$");
    await wait(800);
    await shot("1-home.png");

    // The composer's place menu lists the choices again (#54 left only
    // "Follow this bot's setting"), Cloud being the server environment.
    check("the composer chip says Auto (Cloud)", await click("button", "^Where this conversation works: Auto \\(Cloud\\)$"));
    await wait(600);
    const menu = await js(`[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].map((item) => item.innerText.split("\\n")[0])`);
    check("the place menu lists Cloud (server environment) and Local VM", menu.includes("Cloud (server environment)") && menu.includes("Local VM"), menu.join(", "));
    await shot("2-place-menu.png");
    await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    await wait(400);

    // The Computer tab: no selector, the server environment, its desktop.
    const computerOf = () => js(`fetch("/api/bots").then(r => r.json()).then(b => JSON.stringify(b.bots.find(x => x.name === "Luna")?.computer ?? "auto"))`);
    log(`Luna's Works on before the panel: ${await computerOf()}`);
    check("opened Luna's panel", await click("button", "^Open Luna's profile$"));
    await wait(1000);
    await click("button", "^Skip tour$");
    await wait(500);
    log(`Luna's Works on after the panel: ${await computerOf()}`);
    check("opened the Computer tab", await click("button,[role=tab]", "^Computer$"));
    await until("the server environment screen", () => js(`Boolean(document.querySelector('[data-computer-source="server"]'))`));
    const tab = await text();
    check("the tab names the computer from Works on, with no selector", tab.includes("Luna works on: Auto (Cloud).") && !tab.includes("Where this bot works") && !(await js(`Boolean(document.querySelector('[role=radiogroup]'))`)));
    const power = await until("the environment's state", () => js(`(() => { const state = document.querySelector('[data-computer-screen]')?.dataset.computerScreen; return state === "off" || state === "running" ? state : null; })()`));
    if (power === "off") {
      await shot("3a-computer-off.png");
      check("pressed Play", await js(`(() => { const b = document.querySelector('[aria-label="Screen controls"] button:not([disabled])'); b?.click(); return Boolean(b); })()`));
    }
    await until("the live desktop", () => js(`Boolean(document.querySelector('[data-sandbox-desktop="connected"]'))`), 120_000);
    await wait(3000);
    // The usage panel follows the start at once, not at its next idle poll.
    const early = await js(`document.querySelector('dl[aria-label="Usage"]')?.innerText ?? ""`);
    check("usage figures right after the desktop shows", /%/.test(early), early.replace(/\n/g, " "));
    await shot("3-computer-view-only.png");
    check("view-only with Take control in the middle", await js(`Boolean(document.querySelector('[data-take-control]')) && document.querySelector('[data-sandbox-desktop]').dataset.control === "0"`));
    const usage = await until("usage figures", async () => {
      const value = await js(`document.querySelector('dl[aria-label="Usage"]')?.innerText ?? ""`);
      return /%/.test(value) && !/\?/.test(value) ? value : null;
    }, 40_000).catch(() => js(`document.querySelector('dl[aria-label="Usage"]')?.innerText ?? ""`));
    check("usage shows CPU, memory, disk and system (no ?)", /%/.test(usage) && !/\?/.test(usage), usage.replace(/\n/g, " "));
    await click("button", "^Take control$");
    await until("control", () => js(`document.querySelector('[data-sandbox-desktop]')?.dataset.control === "1" && Boolean(document.querySelector('[data-sandbox-desktop="connected"]'))`), 40_000);
    await wait(2500);
    check("in control: a Release control chip", await js(`Boolean(document.querySelector('[data-release-control]'))`));
    await shot("4-computer-in-control.png");
    await click("button", "^Release control$");
    await until("view-only again", () => js(`document.querySelector('[data-sandbox-desktop]')?.dataset.control === "0"`));
    check("released control", true);

    // Works on: Cloud (server environment) is there, Auto means Cloud.
    check("opened More", await click("button,[role=tab]", "^More$"));
    await wait(600);
    await click("button,a,[role=button]", "^Access");
    await until("Works on", () => js(`Boolean(document.querySelector('[data-works-on-org]'))`));
    await js(`document.querySelector('[data-works-on-org]').scrollIntoView({ block: "start" })`);
    await wait(500);
    const workson = await js(`document.querySelector('[data-works-on-org]').innerText`);
    check("Works on offers Auto (Cloud) and Cloud (server environment)", workson.includes("Auto (Cloud)") && workson.includes("Cloud (server environment)") && workson.includes("Local VM"), workson.replace(/\n/g, " | "));
    await shot("5-works-on.png");
  } catch (error) {
    log(`error: ${error instanceof Error ? error.stack : String(error)}`);
    await shot("error.png").catch(() => {});
    checks.push(false);
  }
  const failed = checks.filter((ok) => !ok).length;
  log(failed ? `${failed} check(s) failed` : "all checks passed");
  app.exit(failed ? 1 : 0);
});
