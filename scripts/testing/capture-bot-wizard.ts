// Headless captures of the bot creation wizard against a disposable
// fake-engine server: the mode choice, each step, the recap with Try it, and
// the guided mode with the Primary Bot's conversation. Nothing opens a window.
//   node --experimental-strip-types scripts/testing/capture-bot-wizard.ts <outDir> [skin] [lang]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { mountPreview, type MountedPreview } from "./preview-fixture.ts";

const outDir = resolve(process.argv[2] ?? ".omb-scratch/bot-wizard");
const skin = process.argv[3] ?? "midnight";
const lang = process.argv[4] ?? "fr";
mkdirSync(outDir, { recursive: true });

// SAGAX_CAPTURE_CHROME: a headless shell other than the one Playwright pins.
const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath: process.env.SAGAX_CAPTURE_CHROME } : {}) });
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
try {
  // the person's Primary Bot, which guides
  await runControlOmb(["new-bot", "--name", "Chef", "--url", fixture.info.url]);
  const { bots } = await fetch(`${fixture.info.url}/api/bots`).then((r) => r.json()) as { bots: Array<{ id: string; name: string }> };
  const chef = bots.find((bot) => bot.name === "Chef")!;
  await fetch(`${fixture.info.url}/api/bots/${chef.id}/primary`, { method: "POST" });

  ui = await mountPreview(fixture, { entry: "/src/testing/bot-wizard.tsx", route: "/__bot-wizard.html", title: "Bot wizard", logLevel: "error" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    const file = `${outDir}/${name}-${skin}.png`;
    await page.locator("[data-bot-wizard]").screenshot({ path: file });
    console.log(`wrote ${file}`);
  };
  const step = async (target: string) => { await page.waitForSelector(`[data-wizard-step="${target}"]`); };

  await page.waitForSelector("[data-wizard-mode-choice]");
  await shot("01-mode-choice");

  await page.click('[data-wizard-choose="manual"]');
  await step("identity");
  // the role menu (2026-10-27): the inbox role, second in the list
  await page.click("[data-wizard-role-select] [data-pill-select]");
  await page.locator('[role="listbox"] [role="option"]').nth(1).click();
  await shot("02-identity");

  await page.click("[data-wizard-next]");
  await step("soul");
  await page.click('[data-wizard-suggest="tone"]');
  await page.click('[data-wizard-suggest="does"]');
  await shot("03-soul");

  await page.click("[data-wizard-next]");
  await step("rules");
  await page.click('[data-wizard-rule-choice="ask-send-mail:ask"]');
  await page.waitForTimeout(300);
  await page.click('[data-wizard-rule-choice="deny-payment:deny"]');
  await page.waitForTimeout(500);
  await shot("04-rules");

  await page.click("[data-wizard-next]");
  await step("tools");
  await shot("05-tools");

  await page.click("[data-wizard-next]");
  await step("routines");
  await page.click('[data-wizard-routine="inbox-triage"] input');
  await shot("06-routines");

  await page.click("[data-wizard-next]");
  await step("recap");
  await page.click("[data-wizard-try]");
  await page.waitForSelector("[data-wizard-test-chat]");
  await page.waitForTimeout(2500);
  await shot("07-recap");

  // the same draft in guided mode: the conversation with the Primary Bot
  await page.click('[data-wizard-mode="guided"]');
  await page.waitForSelector("[data-wizard-guided-chat] [data-wizard-conversation]", { timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot("08-guided");
  await assertNoError(page);

  // 2026-10-27: a person with no bot at all. Guided creates the Bot
  // designer, which leads.
  for (const each of (await fetch(`${fixture.info.url}/api/bots`).then((r) => r.json()) as { bots: Array<{ id: string }> }).bots) {
    await fetch(`${fixture.info.url}/api/bots/${each.id}`, { method: "DELETE" });
  }
  await page.goto(`${ui.previewUrl}?skin=${encodeURIComponent(skin)}&lang=${encodeURIComponent(lang)}`, { waitUntil: "load" });
  await page.waitForSelector('[data-wizard-mode-choice] [data-wizard-guided-state="designer"]', { timeout: 15_000 });
  await shot("09-mode-choice-no-bot");
  await page.click('[data-wizard-choose="guided"]');
  await page.waitForSelector("[data-wizard-guided-chat] [data-wizard-conversation]", { timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot("10-guided-designer");
  await assertNoError(page);
} finally {
  await browser.close();
  await ui?.close();
  await fixture.close();
}

async function assertNoError(page: Page) {
  const alert = await page.locator('[data-bot-wizard] [role="alert"]').count();
  if (alert) console.log(`warning: ${alert} alert(s) on the last screen`);
}
