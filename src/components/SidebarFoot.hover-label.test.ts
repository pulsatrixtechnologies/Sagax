// The foot, hovered: "Connect apps" is never cut (the rule of #1105), in French
// and in English, with or without the update button beside the pill. Measured in
// a real headless Chromium on the gallery (?view=foot); skipped only when no
// browser is installed (SAGAX_CHROMIUM or Playwright's own).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${root}/`);
type Browser = { newPage(o: object): Promise<any>; close(): Promise<void> };
let browser: Browser | null = null;
let server: ViteDevServer | null = null;
let base = "";

beforeAll(async () => {
  try {
    const { chromium } = require("playwright");
    const executablePath = process.env.SAGAX_CHROMIUM;
    browser = await chromium.launch(executablePath && existsSync(executablePath) ? { executablePath } : {});
  } catch {
    browser = null;
    return;
  }
  server = await createServer({ root, configFile: `${root}/vite.gallery.config.ts`, logLevel: "silent", server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen();
  base = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/src/gallery/sidebar-footer.html`;
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe.each(["fr", "en"])("hovered foot (%s)", (lang) => {
  it.each(["none", "ready"])("keeps the whole label, update=%s", async (update) => {
    if (!browser) return;
    const page = await browser.newPage({ viewport: { width: 380, height: 260 } });
    await page.route("**/api/**", (route: any) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(((p: string) => (p === "/api/bots" ? { bots: [] } : p.includes("routines") ? { routines: [], runs: [] } : {}))(new URL(route.request().url()).pathname)) }));
    await page.goto(`${base}?view=foot&lang=${lang}&apps=3&name=Jean%20Exemplar&update=${update}`, { waitUntil: "load" });
    await page.waitForSelector("[data-connected-apps-stack]", { timeout: 45_000 });
    await page.locator("[data-sidebar-connect-apps]").hover();
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const box = (q: string) => document.querySelector(q)?.getBoundingClientRect();
      const label = document.querySelector<HTMLElement>("[data-connect-apps-label]");
      const pill = box("[data-sidebar-connect-apps]")!;
      const row = box("[data-sidebar-account-row]")!;
      const upd = box("[data-sidebar-update-pill]");
      const stack = box("[data-connected-apps-stack]")!;
      return {
        hot: document.querySelector("[data-sidebar-account-row]")?.getAttribute("data-foot-hot"),
        text: label?.textContent ?? "",
        clipped: label ? label.scrollWidth - label.clientWidth : -1,
        labelRight: label?.getBoundingClientRect().right ?? 0,
        stackLeft: stack.left,
        groupLeft: label?.getBoundingClientRect().left ?? 0,
        groupRight: stack.right,
        pillLeft: pill.left,
        pillRight: pill.right,
        rowRight: row.right,
        updRight: upd?.right ?? 0,
        name: document.querySelector("[data-account-pill-name]")?.getBoundingClientRect().width ?? 0,
      };
    });
    await page.close();
    expect(m.hot).toBe("apps");
    expect(m.text.length).toBeGreaterThan(5);
    expect(m.clipped).toBeLessThanOrEqual(0);
    expect(m.labelRight).toBeLessThanOrEqual(m.stackLeft + 1);
    expect(m.pillRight).toBeLessThanOrEqual(m.rowRight + 1);
    // the label and the logos, together, sit in the middle of the pill
    expect(Math.abs((m.groupLeft + m.groupRight) / 2 - (m.pillLeft + m.pillRight) / 2)).toBeLessThanOrEqual(2);
    expect(m.updRight).toBeLessThanOrEqual(m.rowRight + 1);
  }, 120_000);
});

// At rest, at the default 280px sidebar, with the data an organization server
// really answers (?view=foot&data=real): a long name (as wide as the longest
// one measured in use, ~162px) stays whole beside the logos pill, the avatar
// and the name keep their reference size, and the logos are the apps' own
// marks, never the MCP hosts' generic globe.
describe("foot at rest, real data shape", () => {
  it("keeps the long name whole with the real logos", async () => {
    if (!browser) return;
    const page = await browser.newPage({ viewport: { width: 420, height: 260 } });
    await page.route("**/api/**", (route: any) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(((p: string) => (p === "/api/bots" ? { bots: [] } : p.includes("routines") ? { routines: [], runs: [] } : {}))(new URL(route.request().url()).pathname)) }));
    await page.goto(`${base}?view=foot&data=real&lang=fr&name=${encodeURIComponent("Jean-Michel Exemplar")}`, { waitUntil: "load" });
    await page.waitForSelector("[data-connected-app]", { timeout: 45_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const name = document.querySelector<HTMLElement>("[data-account-pill-name]");
      const avatar = document.querySelector("[data-sidebar-account-pill] > span:first-child")?.getBoundingClientRect();
      return {
        mode: document.querySelector("[data-sidebar-account-row]")?.getAttribute("data-foot-mode"),
        cut: name ? name.scrollWidth - name.clientWidth : -1,
        nameWidth: name?.getBoundingClientRect().width ?? 0,
        font: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
        avatar: avatar?.width ?? 0,
        logos: [...document.querySelectorAll("[data-connected-app] img")].map((img) => img.getAttribute("src") ?? ""),
      };
    });
    await page.close();
    expect(m.mode).toBe("inline");
    expect(m.cut).toBeLessThanOrEqual(0);
    expect(m.nameWidth).toBeGreaterThanOrEqual(161);
    expect(m.font).toBeGreaterThanOrEqual(14.5);
    expect(m.avatar).toBeGreaterThanOrEqual(32);
    expect(m.logos).toHaveLength(3);
    for (const src of m.logos as string[]) expect(src).not.toMatch(/googleapis|githubcopilot|mcp\.twilio/);
    expect((m.logos as string[]).some((src) => /gmail_/.test(src))).toBe(true);
  }, 120_000);
});
