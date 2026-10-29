// Headless captures of the one conversation (Show threads off) against a
// disposable fake-engine server: a bot with three topics (one of them a
// routine's run beside the conversation), seen as the one timeline, then a
// run's thread opened beside it. Nothing opens a window.
//   node --experimental-strip-types scripts/testing/capture-unified-threads.ts <outDir> [skin] [lang]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const outDir = resolve(process.argv[2] ?? ".omb-scratch/unified-threads");
const skin = process.argv[3] ?? "midnight";
const lang = process.argv[4] ?? "fr";
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
  const { bot } = await cli("new-bot", "--name", "Pepper");
  const say = async (threadId: string, text: string) => {
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text, singleStream: true });
    await cli("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30");
  };
  // topic 1: the first conversation
  await say(bot.activeTaskId, "Plan the September invoices: who still owes us?");
  await say(bot.activeTaskId, "Draft the reminder for the two late ones.");
  // topic 2: a New topic (a fresh engine context in the same conversation)
  const second = (await api("POST", `/api/bots/${bot.id}/tasks`, { stream: true })).task.threadId as string;
  await say(second, "New subject: prepare the Friday backup check.");
  // a routine, run once: its run works in its own task and reports here
  const { routine } = await api("POST", "/api/routines", {
    name: "Weekly report", prompt: "Report this run's state.", botId: bot.id, enabled: false, postResults: true,
    schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
  });
  const { run } = await api("POST", `/api/routines/${routine.id}/run`);
  for (let tries = 0; tries < 60; tries++) {
    const state = (await api("GET", "/api/routines")).runs.find((candidate: any) => candidate.id === run.id);
    if (state?.status === "completed") break;
    await new Promise((done) => setTimeout(done, 500));
  }
  // topic 3: the person comes back and writes again
  await say(second, "Thanks. Anything else before the weekend?");

  // the terms of use, accepted once per account (TermsGate), so no dialog
  const terms = await api("GET", "/api/me/terms");
  if (terms?.current) await api("POST", "/api/me/terms", { version: terms.current });

  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__unified.html", title: "One conversation", logLevel: "error" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await page.addInitScript(([skinName, language]) => {
    localStorage.setItem("omb-show-threads", "0");
    localStorage.setItem("omb-advanced-mode", "1");
    localStorage.setItem("omb-skin", skinName);
    localStorage.setItem("omb-language", language);
  }, [skin, lang]);
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  const shot = async (name: string) => {
    await page.waitForTimeout(800);
    const file = `${outDir}/${name}-${skin}.png`;
    await page.screenshot({ path: file });
    console.log(`wrote ${file}`);
  };
  await page.waitForSelector("textarea", { timeout: 30_000 });
  await page.waitForTimeout(1_500);
  // the achievement toasts (a linked account, a first message) are not the subject
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
  await shot("01-one-conversation");
  // scrolled up: the earlier topic, drawn above the live one
  await page.evaluate(() => {
    const log = document.querySelector('[role="log"]')?.parentElement;
    if (log) log.scrollTop = 0;
  });
  await page.waitForTimeout(1_200);
  await shot("02-one-conversation-history");
  // the run's own thread, opened beside the conversation from its card
  const opened = await page.evaluate(() => {
    const link = [...document.querySelectorAll<HTMLElement>("a, button")].find((candidate) => /^(Voir le run|Open run|See the run)/i.test((candidate.textContent ?? "").trim()));
    if (!link) return false;
    link.click();
    return true;
  });
  if (opened) {
    await page.waitForTimeout(1_200);
    await shot("03-run-beside-conversation");
  } else {
    console.log("no run card button found: the beside capture is skipped");
  }
} finally {
  await ui?.close();
  await fixture.close();
  await browser.close();
}
