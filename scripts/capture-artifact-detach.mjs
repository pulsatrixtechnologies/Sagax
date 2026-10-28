#!/usr/bin/env node
/**
 * Headless screenshots of the artifact-detach gallery (Playwright, no window):
 * the Library's dialog with "Open in its own window", the floating panel kept
 * whole inside the app's window, and the panel dragged out of it (the hint,
 * then the desktop app asked for a window of its own at the pointer).
 * No server; nothing opens on screen.
 * Usage: node scripts/capture-artifact-detach.mjs [--out DIR] [--port N] [--lang fr]
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "artifact-detach")));
const port = Number(arg("--port", "5294"));
const lang = arg("--lang", "fr");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

// vite itself, not through pnpm: a SIGTERM must reach the process that listens
const vite = spawn(
  process.execPath,
  [join(root, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.gallery.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" } },
);
let viteLog = "";
vite.stdout?.on("data", (c) => { viteLog += c; });
vite.stderr?.on("data", (c) => { viteLog += c; });

let browser;
try {
  const base = `http://127.0.0.1:${port}/src/gallery/artifact-detach.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 });

  await page.goto(`${base}?view=dialog&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-artifact-dialog] [data-artifact-own-window]", { timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, "library-dialog.png") });
  console.log(`wrote ${join(outDir, "library-dialog.png")}`);

  await page.goto(`${base}?view=panel&lang=${lang}`, { waitUntil: "networkidle" });
  const panel = page.locator('[data-floating-window="artifact:a1"]');
  await panel.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  // the bot asked for x 900 + 520 wide: kept whole inside the 1200 px window
  const box = await panel.boundingBox();
  if (!box || box.x + box.width > 1200 || box.y + box.height > 760) throw new Error(`panel is cut at the edge: ${JSON.stringify(box)}`);
  await page.screenshot({ path: join(outDir, "panel-contained.png") });
  console.log(`wrote ${join(outDir, "panel-contained.png")}`);

  // drag its title bar out of the app's window
  const header = panel.locator("header");
  const start = await header.boundingBox();
  await page.mouse.move(start.x + 40, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 200, start.y + 10, { steps: 5 });
  await page.mouse.move(1260, 300, { steps: 5 });
  await page.waitForTimeout(200);
  const hint = await page.locator("[data-floating-leaving]").count();
  await page.screenshot({ path: join(outDir, "panel-leaving.png") });
  console.log(`wrote ${join(outDir, "panel-leaving.png")} (hint shown: ${hint > 0})`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const asks = await page.evaluate(() => window.artifactWindowAsks);
  console.log(`asked the desktop app: ${JSON.stringify(asks)}`);
  const left = await page.locator('[data-floating-window="artifact:a1"]').count();
  console.log(`floating panel still in the app: ${left > 0}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (viteLog.trim()) console.error(viteLog.trim());
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  vite.kill("SIGTERM");
}
