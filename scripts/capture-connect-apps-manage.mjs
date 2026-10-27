#!/usr/bin/env node
/**
 * Headless screenshots of Connect apps (Playwright, no window): the real
 * panel in the gallery (src/gallery/connect-apps.html?view=manage, a
 * stand-in /api shaped like an organization member's, or an admin's with
 * --role admin), its four tabs (Discover first, where a person lands), My
 * accounts with one service picked, the "..." menu of an entry and its "For
 * which bots"; for an admin, Settings > Organization too.
 * Usage: node scripts/capture-connect-apps-manage.mjs [--out DIR] [--port N]
 *   [--lang fr] [--skin pulsatrix] [--scheme dark|light] [--role member|admin]
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
const scheme = arg("--scheme", "dark");
const skin = arg("--skin", scheme === "light" ? "pulsatrix-light" : "pulsatrix");
const role = arg("--role", "member");

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
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2, colorScheme: scheme });
  page.on("pageerror", (error) => console.error("page error:", error.stack));
  const query = `skin=${skin}&lang=${lang}&role=${role}`;
  await page.goto(`${base}?view=manage&${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-plugins-connected]", { timeout: 30_000 });
  await page.waitForTimeout(600);
  const shot = async (name) => {
    await page.waitForTimeout(700);
    const file = join(outDir, `${name}.png`);
    await page.locator('[role="dialog"]').first().screenshot({ path: file });
    console.log("shot", file);
  };
  await shot("0-connect-apps");
  for (const [index, tab] of ["installed", "discover", "accounts", "sources"].entries()) {
    await page.click(`[data-plugins-tab="${tab}"]`);
    await page.waitForSelector(`[data-plugins-manage="${tab}"]`);
    if (tab === "accounts") await page.waitForSelector("[data-harness-group]", { timeout: 15_000 }).catch(() => undefined);
    if (tab === "sources") await page.waitForTimeout(800);
    await shot(`${index + 1}-${tab}`);
    if (tab === "accounts" && await page.locator('[data-accounts-service-pill="grok"]').count()) {
      await page.click('[data-accounts-service-pill="grok"]');
      await shot("3b-accounts-grok");
      await page.click('[data-accounts-service-pill="servers"]').catch(() => undefined);
      await shot("3c-accounts-servers");
      await page.click('[data-accounts-service-pill="all"]');
    }
    if (tab === "sources" && role === "admin") {
      await page.locator("[data-plugins-sources-admin]").scrollIntoViewIfNeeded();
      await shot("4b-sources-admin");
    }
  }
  await page.click("[data-plugins-connected]");
  await page.waitForSelector('[data-plugins-manage="installed"], [data-plugins-manage="accounts"]');
  await shot("5-connected-opens");
  await page.click('[data-plugins-tab="installed"]');
  await page.locator('[data-installed-entry="plugin:code-review@claude-plugins-official"] [data-entry-menu]').click();
  await shot("6-installed-menu-update");
  await page.keyboard.press("Escape");
  await page.locator('[data-installed-entry="plugin:github@claude-plugins-official"] [data-entry-menu]').click();
  await page.click('[data-entry-action="bots"]');
  await page.waitForSelector("[data-plugins-bots-for]");
  await shot("7-for-which-bots");
  if (role === "admin") {
    await page.goto(`${base}?view=org-settings&${query}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const file = join(outDir, "9-settings-organization.png");
    await page.screenshot({ path: file, fullPage: true });
    console.log("shot", file);
  }
} catch (error) {
  console.error(error);
  console.error(viteLog.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
