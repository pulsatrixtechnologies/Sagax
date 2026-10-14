// Midnight is Grok Bot's own dark theme. JC, 2026-10-14: "Le thème Midnight
// de Sagax doit être identique au thème de Grok Bot." Grok Bot (0.70.2) ships
// "Sand Light" and "Sand Dark"; its dark window is Sand Dark, a neutral ramp
// (window #121212, rail #0e0e0e, pane #161616, raised #1f1f1f) with
// translucent whites over it. This pins those values, and that the key pairs
// stay readable.
//
// The full gate (every pair, every context, every skin) is
// `pnpm check:contrast`, run by popover-contrast.test.ts. This file measures
// the Midnight pairs on their own, with the WCAG targets: primary and
// secondary text 4.5:1, quiet text and icons 3:1.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "src", "styles.css"), "utf8");

type SkinTokens = (css: string, id: string) => Record<string, string> | null;
let tokens: Record<string, string> = {};

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(root, "scripts", "check-skin-contrast.mjs")).href)) as { skinTokens: SkinTokens };
  tokens = mod.skinTokens(css, "midnight") ?? {};
});

type Rgb = { r: number; g: number; b: number; a: number };

function rgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

function over(fg: Rgb, bg: Rgb): Rgb {
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
}

function luminance({ r, g, b }: Rgb): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function ratio(fgToken: string, bgToken: string, underToken = "--color-panel"): number {
  const fgHex = tokens[fgToken];
  const bgHex = tokens[bgToken];
  if (!fgHex || !bgHex) throw new Error(`missing ${!fgHex ? fgToken : bgToken}`);
  const bgRaw = rgb(bgHex);
  const ground = bgRaw.a < 1 ? over(bgRaw, rgb(tokens[underToken]!)) : bgRaw;
  const fg = over(rgb(fgHex), ground);
  const [hi, lo] = [luminance(fg), luminance(ground)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [
  "--color-app",
  "--color-panel",
  "--color-sidebar",
  "--color-inset",
  "--color-card",
  "--color-menu",
  "--color-popover",
  "--color-raised",
  "--color-composer",
  "--color-raised-hover",
  "--color-elevated",
];

// Sand Dark, resolved: primitives neutral/0..5, base #f5f5f5 at Grok Bot's
// dark opacities (text 66/54%, hover 6%, selected 10%, user bubble 18%).
const GROK_BOT_SAND_DARK: Record<string, string> = {
  "--color-app": "#121212",
  "--color-sidebar": "#0e0e0e",
  "--color-panel": "#161616",
  "--color-inset": "#1b1b1b",
  "--color-card": "#1f1f1f",
  "--color-menu": "#1f1f1f",
  "--color-raised": "#1f1f1f",
  "--color-composer": "#1f1f1f",
  "--color-control": "#282828",
  "--color-raised-hover": "#2c2c2c",
  "--color-bubble-user": "#3b3b3b",
  "--color-ink": "#f5f5f5",
  "--color-ink-secondary": "#f5f5f5a8",
  "--color-ink-tertiary": "#f5f5f58a",
  "--color-sidebar-ink": "#f5f5f5",
  "--color-sidebar-ink-secondary": "#f5f5f5a8",
  "--color-sidebar-hover": "#f5f5f50f",
  "--color-sidebar-selected": "#f5f5f51a",
  "--color-accent": "#f5f5f5",
  "--color-accent-border": "#dbdbdb",
  "--color-accent-ink": "#121212",
  "--color-focus": "#1884fc",
  "--color-unread": "#1884fc",
  "--color-success": "#00ba69",
  "--color-danger": "#ff6463",
  "--color-warning": "#e28600",
};

describe("Midnight skin: Grok Bot's Sand Dark", () => {
  it("resolves every surface it paints", () => {
    for (const surface of SURFACES) expect(tokens[surface], surface).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("takes Grok Bot's values", () => {
    for (const [token, value] of Object.entries(GROK_BOT_SAND_DARK)) expect(tokens[token], token).toBe(value);
  });

  it("paints neutral greys, as Grok Bot does", () => {
    for (const surface of SURFACES) {
      const { r, g, b } = rgb(tokens[surface]!);
      expect(Math.max(r, g, b) - Math.min(r, g, b), surface).toBeLessThanOrEqual(2);
    }
  });

  it("keeps Grok Bot's ladder: the rail under the window, each step lighter", () => {
    const ladder = ["--color-sidebar", "--color-app", "--color-panel", "--color-inset", "--color-card", "--color-raised-hover", "--color-bubble-user"];
    const values = ladder.map((token) => luminance(rgb(tokens[token]!)));
    for (let i = 1; i < values.length; i++) expect(values[i], ladder[i]).toBeGreaterThan(values[i - 1]!);
  });

  it("primary and secondary text clear 4.5:1 on every surface", () => {
    for (const surface of SURFACES) {
      expect(ratio("--color-ink", surface), `ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio("--color-ink-secondary", surface), `ink-secondary on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio("--color-sidebar-ink", "--color-sidebar")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-sidebar-ink-secondary", "--color-sidebar")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-sidebar-ink", "--color-sidebar-selected", "--color-sidebar")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-bubble-user-ink", "--color-bubble-user")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-accent-ink", "--color-accent")).toBeGreaterThanOrEqual(4.5);
  });

  it("quiet text, icons and field outlines clear 3:1", () => {
    for (const surface of SURFACES) {
      expect(ratio("--color-ink-tertiary", surface), `ink-tertiary on ${surface}`).toBeGreaterThanOrEqual(3);
      expect(ratio("--color-accent", surface), `accent on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio("--color-popover-border", "--color-menu")).toBeGreaterThanOrEqual(3);
    expect(ratio("--color-popover-border", "--color-inset")).toBeGreaterThanOrEqual(3);
    expect(ratio("--color-focus", "--color-raised")).toBeGreaterThanOrEqual(3);
  });

  it("the native window chrome follows the new ground", () => {
    const overlay = readFileSync(join(root, "electron", "skin-overlay.cjs"), "utf8");
    expect(overlay).toContain(`midnight: Object.freeze({ color: "${tokens["--color-app"]}"`);
  });
});
