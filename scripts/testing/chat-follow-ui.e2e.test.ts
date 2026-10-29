// The transcript stays at its bottom while a bot works, end to end and
// headless: a real server (the verification fixture, fake engine in slow
// mode), the real renderer in a headless Chromium (the same isolated preview
// the captures mount), a long conversation with an earlier topic drawn above
// the live one. A turn is held open on a gate while the pane around the
// transcript changes the way it does in use: a banner shows above it (the
// offline line; a routine failure or an error line take the same place) and
// the window gets shorter. The distance to the bottom is sampled on every
// frame. The rules:
//   - a reader at the bottom stays there for the whole turn and after it;
//   - a reader who scrolled up is not moved: the rows under them stay put
//     and "Jump to latest" shows.
//
// Needs a Chromium for Playwright: its own download, or SAGAX_CAPTURE_CHROME
// (a chrome-headless-shell or Chrome binary). Without one it is skipped with
// a notice; SAGAX_UI_E2E=1 makes the missing browser a failure.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "../control-omb.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./preview-fixture.ts";

const executablePath = process.env.SAGAX_CAPTURE_CHROME || (() => {
  try { return chromium.executablePath(); } catch { return ""; }
})();
const available = Boolean(executablePath) && existsSync(executablePath);
const required = process.env.SAGAX_UI_E2E === "1";
if (!available && !required) console.log("skipping chat-follow ui e2e: no Chromium for Playwright (pnpm exec playwright install chromium, or SAGAX_CAPTURE_CHROME)");
const suite = available || required ? describe : describe.skip;

// Bottom-follow allows subpixel slack (BOTTOM_FOLLOW_THRESHOLD).
const SLACK = 4;
// One frame off while React commits a row and the next frame pins it is not
// what a person sees; a pane left off the bottom stays off for many frames.
const MAX_FRAMES_OFF = 3;

suite("the transcript follows the bottom while a bot works", () => {
  const gates = mkdtempSync(join(tmpdir(), "chat-follow-gates-"));
  const saved = { mode: process.env.FAKE_CLAUDE_MODE, gates: process.env.FAKE_CLAUDE_GATE_DIR, hold: process.env.FAKE_CLAUDE_HOLD_AFTER_TOOL, tool: process.env.FAKE_CLAUDE_HOLD_TOOL };
  let fixture: VerificationServer | undefined;
  let ui: MountedPreview | undefined;
  let browser: Browser | undefined;
  let page: Page;

  beforeAll(async () => {
    // slow mode: each turn calls one tool and holds it, then answers once
    // its [gate:NAME] file exists ("h" is open from the start)
    process.env.FAKE_CLAUDE_MODE = "slow";
    process.env.FAKE_CLAUDE_GATE_DIR = gates;
    process.env.FAKE_CLAUDE_HOLD_AFTER_TOOL = "1";
    process.env.FAKE_CLAUDE_HOLD_TOOL = JSON.stringify({ name: "Bash", input: { command: "python scrape.py" } });
    writeFileSync(join(gates, "h"), "");
    fixture = await launchVerificationServer();
    const url = fixture.info.url;
    const api = fixtureApi(url, { headers: { origin: url } });
    const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
    const { bot } = await cli("new-bot", "--name", "Pepper");
    const say = async (threadId: string, text: string) => {
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId, text, singleStream: true });
      await cli("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30");
    };
    const long = "The quarterly numbers, the open tickets and the backup check, line by line. ".repeat(5);
    // an earlier topic, then the live one: one conversation, history above
    for (let turn = 0; turn < 3; turn++) await say(bot.activeTaskId, `[gate:h] earlier ${turn} ${long}`);
    const live = (await api("POST", `/api/bots/${bot.id}/tasks`, { stream: true })).task.threadId as string;
    for (let turn = 0; turn < 8; turn++) await say(live, `[gate:h] history ${turn} ${long}`);
    const terms = await api("GET", "/api/me/terms");
    if (terms?.current) await api("POST", "/api/me/terms", { version: terms.current });

    ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__chat-follow.html", title: "Chat follow", logLevel: "error" });
    browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_CAPTURE_CHROME ? { executablePath } : {}) });
    page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.addInitScript(() => {
      localStorage.setItem("omb-show-threads", "0");
      localStorage.setItem("omb-language", "en");
    });
    await page.goto(ui.previewUrl, { waitUntil: "load" });
    await page.waitForSelector("textarea", { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    // the achievement toasts are not the subject
    for (let tries = 0; tries < 6; tries++) {
      const closed = await page.evaluate(() => {
        const close = document.querySelector<HTMLButtonElement>(".achievement-toast-close");
        close?.click();
        return Boolean(close);
      });
      if (!closed) break;
      await page.waitForTimeout(300);
    }
    // every frame: how far the transcript's bottom is below the pane's
    await page.evaluate(() => {
      const scroller = document.querySelector('[role="log"]')!.parentElement!;
      const state = { frames: [] as number[] };
      (window as unknown as { __follow: typeof state }).__follow = state;
      const tick = () => {
        state.frames.push(Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await ui?.close();
    await fixture?.close();
    await removeTempDir(gates);
    for (const [key, value] of [["FAKE_CLAUDE_MODE", saved.mode], ["FAKE_CLAUDE_GATE_DIR", saved.gates], ["FAKE_CLAUDE_HOLD_AFTER_TOOL", saved.hold], ["FAKE_CLAUDE_HOLD_TOOL", saved.tool]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 60_000);

  const distance = () => page.evaluate(() => {
    const scroller = document.querySelector('[role="log"]')!.parentElement!;
    return Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
  });
  /** Frames sampled since the last call; the longest run off the bottom. */
  const framesOff = () => page.evaluate((slack) => {
    const state = (window as unknown as { __follow: { frames: number[] } }).__follow;
    const frames = state.frames.splice(0);
    let run = 0;
    let longest = 0;
    for (const frame of frames) {
      run = frame > slack ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return { longest, worst: Math.max(0, ...frames), count: frames.length };
  }, SLACK);
  const jumpPill = () => page.evaluate(() => Boolean(document.querySelector('[aria-label="Jump to latest messages"]')));
  const settle = () => page.waitForTimeout(600);

  it("keeps a reader at the bottom through a turn, a banner and a shorter window", async () => {
    expect(await distance()).toBeLessThanOrEqual(SLACK);
    await framesOff();

    await page.fill("textarea", "[gate:live] Check the backups and tell me what failed");
    await page.keyboard.press("Enter");
    // the working line names the held step
    await page.waitForFunction(() => /scrape\.py/.test(document.querySelector('[role="log"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);

    // a banner above the transcript (offline here) shortens the pane
    await page.context().setOffline(true);
    await page.waitForSelector("[data-chat-stale]");
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);
    await page.context().setOffline(false);
    await page.waitForSelector("[data-chat-stale]", { state: "detached" });
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);

    // the window gets shorter, then taller again
    await page.setViewportSize({ width: 1280, height: 680 });
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);
    await page.setViewportSize({ width: 1280, height: 820 });
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);

    // the turn ends: the reply replaces the working line
    writeFileSync(join(gates, "live"), "");
    await page.waitForFunction(() => /reply to: .*Check the backups/s.test(document.querySelector('[role="log"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
    await settle();
    expect(await distance()).toBeLessThanOrEqual(SLACK);

    const frames = await framesOff();
    expect(frames.count).toBeGreaterThan(20);
    expect(frames.longest, `the pane stayed off the bottom (worst ${frames.worst}px)`).toBeLessThanOrEqual(MAX_FRAMES_OFF);
    expect(await jumpPill()).toBe(false);
  }, 120_000);

  it("leaves a reader who scrolled up where they are", async () => {
    await page.mouse.move(640, 400);
    for (let step = 0; step < 4; step++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(60);
    }
    await settle();
    expect(await jumpPill()).toBe(true);
    // the row at the middle of the pane, and where it sits on screen
    const anchor = () => page.evaluate(() => {
      const scroller = document.querySelector('[role="log"]')!.parentElement!;
      const box = scroller.getBoundingClientRect();
      // a row wrapper is display: contents; its last child is the drawn row
      const row = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("[data-mid]");
      const drawn = row?.lastElementChild;
      return row && drawn ? { id: row.getAttribute("data-mid"), top: Math.round(drawn.getBoundingClientRect().top) } : null;
    });
    const before = await anchor();
    expect(before).not.toBeNull();

    await page.context().setOffline(true);
    await page.waitForSelector("[data-chat-stale]");
    await settle();
    const during = await page.evaluate((id) => {
      const drawn = document.querySelector(`[data-mid="${CSS.escape(id!)}"]`)?.lastElementChild;
      return drawn ? Math.round(drawn.getBoundingClientRect().top) : null;
    }, before!.id);
    await page.context().setOffline(false);
    await page.waitForSelector("[data-chat-stale]", { state: "detached" });
    await settle();
    const after = await page.evaluate((id) => {
      const drawn = document.querySelector(`[data-mid="${CSS.escape(id!)}"]`)?.lastElementChild;
      return drawn ? Math.round(drawn.getBoundingClientRect().top) : null;
    }, before!.id);

    expect(Math.abs((during ?? Infinity) - before!.top)).toBeLessThanOrEqual(1);
    expect(Math.abs((after ?? Infinity) - before!.top)).toBeLessThanOrEqual(1);
    expect(await distance()).toBeGreaterThan(SLACK);
    expect(await jumpPill()).toBe(true);
  }, 60_000);
});
