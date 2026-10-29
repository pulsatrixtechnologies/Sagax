// Headless captures of the split view's pills against a disposable
// fake-engine server: a bot section on the left, the main chat in the
// middle, a group section on the right. The bot section's pill opens its
// bot's panel, then the group section's pill opens the group's: each time
// the one panel sits at the window's right edge. Nothing opens a window.
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
  const { bot: third } = await cli("new-bot", "--name", "Juniper");
  const say = async (bot: any, text: string) => {
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.activeTaskId, text, singleStream: true });
    await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30");
  };
  await say(main, "Summarize today's open tasks.");
  await say(side, "Draft the weekly backup check list.");
  const created = await api("POST", "/api/groups", { name: "Crew", memberIds: [side.id, third.id], setup: { bulletin: "", defaultResponder: { kind: "member", botId: side.id } } });
  const group = created.group ?? created;
  const terms = await api("GET", "/api/me/terms");
  if (terms?.current) await api("POST", "/api/me/terms", { version: terms.current });

  const layout = {
    type: "split", id: "split-capture", dir: "row", sizes: [0.34, 0.33, 0.33],
    children: [
      { type: "leaf", id: "pane-bot", target: { kind: "bot", botId: side.id } },
      { type: "leaf", id: "main", target: null },
      { type: "leaf", id: "pane-group", target: { kind: "group", groupId: group.id } },
    ],
  };
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__split.html", title: "Split view", logLevel: "error" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 860 }, deviceScaleFactor: 2 });
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
  await shot("01-sections");
  // the bot section's pill (on the left): its panel
  const botPill = page.locator(`[data-split-pane="bot:${side.id}"] [data-bot-header-pill]`);
  if (await botPill.count()) {
    await botPill.click();
    await shot("02-bot-panel");
  } else {
    console.log("no pill in the bot section: its panel capture is skipped");
  }
  // the group section's pill (on the right): the group's panel
  const groupPill = page.locator(`[data-split-pane="group:${group.id}"] [data-bot-header-pill]`);
  if (await groupPill.count()) {
    await groupPill.click();
    await shot("03-group-panel");
  } else {
    console.log("no pill in the group section: its panel capture is skipped");
  }
} finally {
  await ui?.close();
  await fixture.close();
  await browser.close();
}
