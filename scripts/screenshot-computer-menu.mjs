// Screenshots of the Computer tab's machine menu, light and dark.
// Serves preview/computer-menu.html with Vite, then drives it with Playwright.
//
//   node scripts/screenshot-computer-menu.mjs
//
// Chromium comes from a local Playwright install (PLAYWRIGHT_MODULE, or
// /tmp/sagax-playwright/node_modules/playwright).
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.COMPUTER_MENU_PORT ?? 4173);
const outDir = process.env.COMPUTER_MENU_OUT ?? "/opt/cursor/artifacts";
const modulePath = process.env.PLAYWRIGHT_MODULE ?? "/tmp/sagax-playwright/node_modules/playwright/index.js";

const vite = spawn(
  "pnpm",
  ["exec", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
vite.stdout.on("data", (chunk) => { log += chunk; });
vite.stderr.on("data", (chunk) => { log += chunk; });
const stop = () => { if (!vite.killed) vite.kill("SIGTERM"); };
process.on("exit", stop);

const ready = await Promise.race([
  (async () => {
    while (!log.includes("Local:") && !log.includes("localhost") && !log.includes("127.0.0.1")) {
      if (vite.exitCode !== null) throw new Error(log || "vite exited");
      await delay(100);
    }
  })(),
  delay(20_000).then(() => { throw new Error(`vite did not start\n${log}`); }),
]);
void ready;

const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
await mkdir(outDir, { recursive: true });

const shots = [
  { file: "computer-menu-dark-fr.png", lang: "fr", skin: "pulsatrix", off: "Éteint", on: "Allumé", cloud: "Infonuagique", browserName: "Navigateur", here: "Travaille ici" },
  { file: "computer-menu-light-en.png", lang: "en", skin: "pulsatrix-light", off: "Off", on: "On", cloud: "Cloud", browserName: "Browser", here: "Works here" },
];

try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 640, height: 720 }, deviceScaleFactor: 2 });
    const url = `http://127.0.0.1:${port}/preview/computer-menu.html?lang=${shot.lang}&skin=${shot.skin}`;
    await page.goto(url, { waitUntil: "networkidle" });
    const trigger = page.locator("[data-computer-picker] button").first();
    await trigger.click();
    const menu = page.locator("[data-computer-menu]");
    await menu.waitFor({ state: "visible" });
    const host = menu.locator('[data-computer-choice="desktop:mbp"] [data-computer-name]');
    const hostText = (await host.innerText()).trim();
    if (hostText !== "Jean-Christophes-MacBook-Pro") {
      throw new Error(`${shot.file}: expected the full host name, got ${JSON.stringify(hostText)}`);
    }
    const clipped = await host.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    if (clipped) throw new Error(`${shot.file}: the host name is clipped`);
    const menuText = await menu.innerText();
    for (const word of [shot.cloud, shot.browserName, shot.off, shot.on, shot.here, "Jean-Christophes-MacBook-Pro"]) {
      if (!menuText.includes(word)) throw new Error(`${shot.file}: menu is missing ${JSON.stringify(word)}\n${menuText}`);
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await menu.waitFor({ state: "hidden" });
    const chosen = await page.locator("[data-computer-picker] button").first().getAttribute("data-computer-choice");
    if (chosen !== "desktop:mbp") throw new Error(`${shot.file}: keyboard chose ${chosen}`);
    const chosenName = (await page.locator("[data-computer-picker] [data-computer-name]").first().innerText()).trim();
    if (chosenName !== "Jean-Christophes-MacBook-Pro") {
      throw new Error(`${shot.file}: selected name is ${JSON.stringify(chosenName)}`);
    }
    if (!(await page.locator('[data-computer-picker] [data-computer-power="on"]').count())) {
      throw new Error(`${shot.file}: the selected machine has no On status`);
    }
    await trigger.click();
    await menu.waitFor({ state: "visible" });
    await page.screenshot({ path: `${outDir}/${shot.file}` });
    await page.close();
    console.log(`wrote ${outDir}/${shot.file}`);
  }
} finally {
  await browser.close();
  stop();
}
