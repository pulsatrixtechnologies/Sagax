#!/usr/bin/env node
/**
 * Headless screenshots of Connect apps > Manage plugins and skills
 * (Playwright, no window): the real panel in the gallery
 * (src/gallery/connect-apps.html?view=manage, a stand-in /api shaped like
 * an organization member's), each of the four tabs, the "..." menu of an
 * entry and its "For which bots". Dark by default.
 * Usage: node scripts/capture-connect-apps-manage.mjs [--out DIR] [--port N] [--lang fr] [--skin pulsatrix]
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
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "connect-apps-manage")));
const port = Number(arg("--port", "5297"));
const lang = arg("--lang", "fr");
const skin = arg("--skin", "pulsatrix");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const res = await fetch(url); if (res.status < 500) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vite gallery did not start at ${url}`);
}

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
  const base = `http://127.0.0.1:${port}/src/gallery/connect-apps.html`;
  await waitForServer(base);
  const { chromium } = await import(process.env.SAGAX_VERIFY_PLAYWRIGHT || "playwright");
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch(process.env.SAGAX_CHROMIUM ? { executablePath: process.env.SAGAX_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2, colorScheme: "dark" });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  await page.goto(`${base}?view=manage&skin=${skin}&lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-plugins-connected]", { timeout: 30_000 });
  await page.waitForTimeout(600);
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = join(outDir, `${name}.png`);
    await page.locator('[role="dialog"]').first().screenshot({ path: file });
    console.log("shot", file);
  };
  await shot("0-connect-apps");
  await page.click("[data-plugins-connected]");
  await page.waitForSelector("[data-plugins-manage-tabs]");
  for (const [index, tab] of ["installed", "discover", "accounts", "sources"].entries()) {
    await page.click(`[data-plugins-tab="${tab}"]`);
    await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
    if (tab === "accounts") await page.waitForSelector("[data-harness-group]", { timeout: 15_000 }).catch(() => undefined);
    await shot(`${index + 1}-${tab}`);
  }
  await page.click('[data-plugins-tab="installed"]');
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] [data-entry-menu]').click();
  await shot("5-installed-menu-update");
  await page.keyboard.press("Escape");
  await page.locator('[data-installed-entry="plugin:github@claude-plugins-official"] [data-entry-menu]').click();
  await shot("5-installed-menu");
  await page.click('[data-entry-action="bots"]');
  await page.waitForSelector("[data-plugins-bots-for]");
  await shot("6-for-which-bots");
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
