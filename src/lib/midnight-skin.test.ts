// Midnight is night blue, not black. JC, 2026-10-14: with Midnight the
// windows (rail, chat, bot panel, popovers, fields, routine cards) were
// near-black (#070707 / #111111 / #262626) beside a night-blue desktop,
// "les fenêtres sont trop noires". The palette moved to a night-blue ladder;
// this pins that it stays blue and that its key pairs stay readable.
//
// The full gate (every pair, every context, every skin) is
// `pnpm check:contrast`, run by popover-contrast.test.ts. This file measures
// the Midnight pairs named in the request on their own, with the WCAG
// targets: primary and secondary text 4.5:1, quiet text and icons 3:1.
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

describe("Midnight skin: night blue", () => {
  it("resolves every surface it paints", () => {
    for (const surface of SURFACES) expect(tokens[surface], surface).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("paints its windows blue, not black or grey", () => {
    for (const surface of SURFACES) {
      const { r, g, b } = rgb(tokens[surface]!);
      // blue leads both other channels clearly: a navy, not a neutral grey
      expect(b - Math.max(r, g), surface).toBeGreaterThanOrEqual(18);
      // and the ground is not the old near-black (#070707 measured 0.002)
      expect(luminance(rgb(tokens[surface]!)), surface).toBeGreaterThan(0.005);
    }
  });

  it("keeps the ladder: each step lighter than the one under it", () => {
    const ladder = ["--color-app", "--color-panel", "--color-inset", "--color-card", "--color-raised", "--color-raised-hover", "--color-bubble-user"];
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
