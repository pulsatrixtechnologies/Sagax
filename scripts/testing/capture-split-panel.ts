// Headless captures of the split view's bot pill against a disposable
// fake-engine server: two sections side by side (a bot section on the left,
// the main chat on the right), the left section's pill opening its bot's
// panel at the window's left edge, then the main chat's pill taking the one
// panel back to the right. Nothing opens a window.
//   node --experimental-strip-types scripts/testing/capture-split-panel.ts <outDir> [prefix] [skin] [lang]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const outDir = resolve(process.argv[2] ?? ".omb-scratch/split-panel");
const prefix = process.argv[3] ?? "after";
const skin = process.argv[4] ?? "midnight";
const lang = process.argv[5] ?? "fr";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath: process.env.SAGAX_CAPTURE_CHROME } : {}) });
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  const url = fixture.info.url;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return response.json() as Promise<any>;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const { bot: main } = await cli("new-bot", "--name", "Pepper");
  const { bot: side } = await cli("new-bot", "--name", "Scout");
  const say = async (bot: any, text: string) => {
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.activeTaskId, text, singleStream: true });
    await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30");
  };
  await say(main, "Summarize today's open tasks.");
  await say(side, "Draft the weekly backup check list.");
  const terms = await api("GET", "/api/me/terms");
  if (terms?.current) await api("POST", "/api/me/terms", { version: terms.current });

  const layout = {
    type: "split", id: "split-capture", dir: "row", sizes: [0.5, 0.5],
    children: [{ type: "leaf", id: "pane-capture", target: { kind: "bot", botId: side.id } }, { type: "leaf", id: "main", target: null }],
  };
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__split.html", title: "Split view", logLevel: "error" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
  await page.addInitScript(([skinName, language, stored]) => {
    localStorage.setItem("omb-show-threads", "0");
    localStorage.setItem("omb-skin", skinName);
    localStorage.setItem("omb-language", language);
    localStorage.setItem("sagax.splitView.layout.v1", stored);
  }, [skin, lang, JSON.stringify(layout)]);
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  await page.waitForSelector("textarea", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  // the main chat shows Pepper: pick its sidebar row
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll<HTMLElement>("nav [role='button'], nav button, aside button, aside [role='button']")].find((candidate) => (candidate.textContent ?? "").trim().startsWith(name));
    row?.click();
  }, "Pepper");
  await page.waitForTimeout(1_000);
  for (let tries = 0; tries < 6; tries++) {
    const closed = await page.evaluate(() => {
      const close = document.querySelector<HTMLButtonElement>(".achievement-toast-close");
      if (!close) return false;
      close.click();
      return true;
    });
    if (!closed) break;
    await page.waitForTimeout(600);
  }
  const shot = async (name: string) => {
    await page.waitForTimeout(900);
    const file = `${outDir}/${prefix}-${name}.png`;
    await page.screenshot({ path: file });
    console.log(`wrote ${file}`);
  };
  await shot("01-two-sections");
  // the left section's pill (after) or its name (before)
  const sidePill = page.locator(`[data-split-pane="bot:${side.id}"] [data-bot-header-pill]`);
  if (await sidePill.count()) {
    await sidePill.click();
    await shot("02-panel-left");
  } else {
    console.log("no pill in the section: the left panel capture is skipped");
  }
  // the main chat's pill: the one panel goes back to the right edge
  await page.locator(`[data-split-leaf="main"] [data-bot-header-pill]`).first().click();
  await shot("03-panel-right");
} finally {
  await ui?.close();
  await fixture.close();
  await browser.close();
}
