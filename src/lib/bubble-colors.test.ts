// The conversation bubbles (2026-10-28): the person's own message is filled
// with the accent, a bot's reply (and another person's message in a room) is a
// neutral grey, and the text on the accent reads at 4.5:1 or better (WCAG 1.4.3)
// (2026-10-29: the accent exactly, the accent button's ink on it)
// on every skin, colour, Full colour, duo-tone, mood and Windows edition, plus
// a brand accent over every skin.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BRAND_BUBBLE_VARS, BUBBLE_MIN_CONTRAST, accentInk, brandBubbleVars, bubbleColors, userBubble, type BubbleColors } from "./bubble-colors";
import { contrastHex, parseHex, type Scheme } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Context = { id: string; selector: string; scheme: Scheme; app: string; ink: string; accent: string; buttonInk?: string; colors: BubbleColors };
let contexts: Context[];
let generated: string;
let css: string;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-bubble-tokens.mjs")).href)) as {
    bubbleContexts: () => Context[];
    bubbleStylesheet: () => string;
  };
  contexts = mod.bubbleContexts();
  generated = mod.bubbleStylesheet();
  css = readFileSync(join(ROOT, "src/styles/skin-bubble.css"), "utf8");
});

/** The values the shipped stylesheet gives one selector (a brand fallback read as its default). */
function shipped(selector: string): BubbleColors {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no block for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("}", at));
  const value = (name: string) => {
    const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
    return raw.startsWith("var(") ? raw.replace(/^var\([^,]+,\s*/, "").replace(/\)$/, "") : raw;
  };
  return { user: value("--color-bubble-user"), userInk: value("--color-bubble-user-ink"), bot: value("--color-bubble-bot") };
}

describe("bubble colours", () => {
  it("covers every skin, colour, duo-tone, mood and edition, in both schemes", () => {
    const ids = new Set(contexts.map((c) => c.id));
    for (const family of ["pulsatrix", "pulsatrix-light", "midnight", "daylight", "atelier", "foundry"]) {
      expect(ids.has(family)).toBe(true);
      for (const tint of ["red", "pink", "green", "yellow", "aurore", "ocean", "neon", "foret", "sunset", "nordic"]) expect(ids.has(`${family}+${tint}`), `${family}+${tint}`).toBe(true);
    }
    expect([...ids].some((id) => id.startsWith("retro98+"))).toBe(true);
    expect(new Set(contexts.map((c) => c.scheme))).toEqual(new Set(["light", "dark"]));
  });

  it("the stylesheet is the derivation's output (pnpm gen:bubble after a palette change)", () => {
    expect(css).toBe(generated);
    expect(readFileSync(join(ROOT, "src/styles.css"), "utf8")).toContain('@import "./styles/skin-bubble.css";');
  });

  it("reads the text on the person's bubble at 4.5:1 or better, for every skin and accent as shipped", () => {
    const problems = contexts.flatMap((c) => {
      const s = shipped(c.selector);
      const ratio = contrastHex(s.userInk, s.user);
      return ratio >= BUBBLE_MIN_CONTRAST ? [] : [`${c.id}: ${ratio.toFixed(2)}:1`];
    });
    expect(problems).toEqual([]);
  });

  it("fills the person's bubble with the accent exactly, the colour its accent buttons are filled with", () => {
    for (const c of contexts) {
      expect(c.colors.user, c.id).toBe(c.accent.toLowerCase());
      // the skin's own button ink is kept wherever it reads on the accent
      if (c.buttonInk && contrastHex(c.buttonInk, c.accent) >= BUBBLE_MIN_CONTRAST) expect(c.colors.userInk, c.id).toBe(c.buttonInk.toLowerCase());
      else expect(c.colors.userInk, c.id).toBe(accentInk(c.accent));
    }
    expect(userBubble("#2f62dd")).toEqual({ user: "#2f62dd", userInk: "#ffffff" });
  });

  it("makes the bot's bubble a neutral grey off the page, with the page's own text readable on it", () => {
    for (const c of contexts) {
      const bot = shipped(c.selector).bot;
      const [r, g, b] = parseHex(bot)!;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${c.id} ${bot}`).toBeLessThanOrEqual(1);
      expect(bot.toLowerCase(), c.id).not.toBe(c.app.toLowerCase());
      const ratio = contrastHex(c.ink, bot);
      expect(ratio, `${c.id}: ink ${c.ink} on ${bot}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      // lighter than a dark page, darker than a light one
      expect(c.scheme === "dark" ? contrastHex(bot, "#ffffff") < contrastHex(c.app, "#ffffff") : contrastHex(bot, "#ffffff") > contrastHex(c.app, "#ffffff"), c.id).toBe(true);
    }
  });

  it("holds 4.5:1 for any brand accent, a hue sweep included", () => {
    const accents = ["#f97316", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ffffff", "#000000", "#808080", "#e8e8e8", "#c2410c", "#7c3aed", "#14b8a6"];
    for (let hue = 0; hue < 360; hue += 15) accents.push(`hsl:${hue}`);
    for (const accent of accents) {
      const hex = accent.startsWith("hsl:") ? hslHex(Number(accent.slice(4))) : accent;
      const { user, userInk } = userBubble(hex);
      expect(user, hex).toBe(hex.toLowerCase());
      expect(userInk, hex).toBe(accentInk(hex));
      expect(contrastHex(userInk, user), `${hex} -> ${userInk}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      const vars = brandBubbleVars(hex);
      expect(vars["--brand-bubble-user"]).toBe(user);
      expect(vars["--brand-bubble-user-ink"]).toBe(userInk);
    }
    expect(Object.keys(brandBubbleVars("#f97316")).sort()).toEqual([...BRAND_BUBBLE_VARS].sort());
    expect(brandBubbleVars("not a colour")).toEqual({});
    expect(brandBubbleVars(undefined)).toEqual({});
  });

  // Regression (2026-10-29): the orange bubble was a darker orange than the
  // accent button beside it, its lightness moved so white could read on it.
  it("keeps an orange accent its exact bright orange, with the button's dark ink", () => {
    for (const orange of ["#f97316", "#ff9500", "#e78531"]) {
      const { user, userInk } = userBubble(orange);
      expect(user).toBe(orange);
      expect(userInk).toBe("#111111");
      expect(contrastHex(user, userInk)).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
    }
    // a dark accent keeps white
    expect(userBubble("#5b21b6").userInk).toBe("#ffffff");
    // a skin's own button ink wins where it reads
    expect(userBubble("#f97316", "#1c150c").userInk).toBe("#1c150c");
    expect(userBubble("#2f62dd", "#111111").userInk).toBe("#ffffff");
  });

  it("accentInk is white or near black, black only where neither reaches 4.5:1", () => {
    for (let hue = 0; hue < 360; hue += 5) for (const hex of [hslHex(hue), "#808080", "#767676", "#949494"]) {
      const ink = accentInk(hex);
      expect(contrastHex(ink, hex), `${hex} ${ink}`).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
      if (ink === "#000000") expect(Math.max(contrastHex(hex, "#ffffff"), contrastHex(hex, "#111111"))).toBeLessThan(BUBBLE_MIN_CONTRAST);
    }
  });

  it("bubbleColors combines both", () => {
    const c = bubbleColors({ accent: "#2f62dd", app: "#ffffff", scheme: "light" });
    expect(c.user).toBe("#2f62dd");
    expect(parseHex(c.bot)![0]).toBeLessThan(255);
  });
});

describe("bubble stylesheet rules", () => {
  const styles = readFileSync(join(ROOT, "src/styles.css"), "utf8");

  it("paints the person's bubble with its own ink and keeps what it holds readable", () => {
    const rule = /\.bg-bubble-user\s*\{([^}]*)\}/.exec(styles)?.[1] ?? "";
    expect(rule).toContain("color: var(--color-bubble-user-ink)");
    for (const token of ["--color-ink", "--color-accent", "--color-accent-text", "--color-ink-secondary", "--color-ink-tertiary"]) {
      expect(rule, token).toMatch(new RegExp(`${token}:\\s*var\\(--color-bubble-user-ink\\)`));
    }
  });

  it("declares the bot's grey as a utility and a default", () => {
    expect(styles).toMatch(/--color-bubble-bot:\s*#[0-9a-f]{6};/i);
    expect(styles).toMatch(/\.bg-bubble-bot\s*\{/);
  });
});

function hslHex(h: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
