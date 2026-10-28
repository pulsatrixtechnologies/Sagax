// The switch must read as on or off on every skin, colour, Full colour,
// duo-tone, mood and Windows edition, light and dark (2026-10-28: a light grey
// thumb on a light grey track, and a dark thumb on a blue track, could not be
// told apart). Every combination is measured here and fails below 3:1
// (WCAG 1.4.11): the white thumb on the on and off tracks, and each track, or
// its edge when it has one, on every surface a switch sits on. A brand accent
// is measured over every skin as well.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BRAND_SURFACES, brandSwitchVars, contrastHex, SWITCH_MIN_CONTRAST, SWITCH_THUMB, switchColors, switchContrasts, type Scheme, type SwitchColors } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Context = { id: string; selector: string; scheme: Scheme; surfaces: string[]; colors: SwitchColors };
let contexts: Context[];
let generated: string;

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-switch-tokens.mjs")).href)) as {
    switchContexts: () => Context[];
    switchStylesheet: () => string;
  };
  contexts = mod.switchContexts();
  generated = mod.switchStylesheet();
});

/** The values the shipped stylesheet gives one selector (a brand fallback read as its default). */
function shipped(css: string, selector: string): SwitchColors {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no block for ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(at, css.indexOf("}", at));
  const value = (name: string) => {
    const raw = new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim() ?? "";
    return raw.startsWith("var(") ? raw.replace(/^var\([^,]+,\s*/, "").replace(/\)$/, "") : raw;
  };
  return { on: value("--color-switch-on"), off: value("--color-switch-off"), onEdge: value("--color-switch-on-edge"), offEdge: value("--color-switch-off-edge") };
}

function failures(id: string, colors: SwitchColors, surfaces: string[]): string[] {
  const c = switchContrasts(colors, surfaces);
  const out: string[] = [];
  for (const [pair, value] of Object.entries(c)) if (value < SWITCH_MIN_CONTRAST) out.push(`${id}: ${pair} ${value.toFixed(2)}:1`);
  return out;
}

describe("switch contrast", () => {
  it("covers every skin, colour, duo-tone, mood and edition, in both schemes", () => {
    const ids = new Set(contexts.map((c) => c.id));
    for (const family of ["pulsatrix", "pulsatrix-light", "midnight", "daylight", "atelier", "foundry"]) {
      expect(ids.has(family)).toBe(true);
      for (const tint of ["red", "pink", "green", "yellow", "aurore", "ocean", "neon", "foret", "sunset", "nordic"]) expect(ids.has(`${family}+${tint}`), `${family}+${tint}`).toBe(true);
      expect(ids.has(`${family}+red+full`), `${family}+red+full`).toBe(true);
    }
    expect(ids.has("midnight+cyberpunk")).toBe(true);
    expect(ids.has("daylight+candy")).toBe(true);
    expect([...ids].some((id) => id.startsWith("retro98+"))).toBe(true);
    expect(new Set(contexts.map((c) => c.scheme))).toEqual(new Set(["light", "dark"]));
    for (const c of contexts) expect(c.surfaces.length, `${c.id} surfaces`).toBeGreaterThanOrEqual(4);
  });

  it("the stylesheet is the derivation's output (pnpm gen:switch after a palette change)", () => {
    expect(readFileSync(join(ROOT, "src/styles/skin-switch.css"), "utf8")).toBe(generated);
    expect(readFileSync(join(ROOT, "src/styles.css"), "utf8")).toContain('@import "./styles/skin-switch.css";');
  });

  it("holds 3:1 for the thumb on both tracks and for each track (or edge) on every surface", () => {
    const css = readFileSync(join(ROOT, "src/styles/skin-switch.css"), "utf8");
    const problems = contexts.flatMap((c) => failures(c.id, shipped(css, c.selector), c.surfaces));
    expect(problems).toEqual([]);
  });

  it("never draws a dark thumb: the thumb is white and the on track carries it", () => {
    expect(SWITCH_THUMB).toBe("#ffffff");
    for (const c of contexts) expect(contrastHex(SWITCH_THUMB, c.colors.on), c.id).toBeGreaterThanOrEqual(SWITCH_MIN_CONTRAST);
  });

  it("keeps the on track in the accent's hue and the off track neutral", () => {
    const studioDark = contexts.find((c) => c.id === "midnight+red")!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(studioDark.colors.on.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    for (const c of contexts) {
      const [x, y, z] = [1, 3, 5].map((i) => parseInt(c.colors.off.slice(i, i + 2), 16));
      expect(Math.max(x, y, z) - Math.min(x, y, z), `${c.id} off ${c.colors.off}`).toBeLessThanOrEqual(40);
    }
  });

  it("darkens or lifts an accent that cannot carry the thumb, and outlines a track a mid-tone surface hides", () => {
    // a near-white accent on a dark skin (the grey-on-grey report)
    const white = switchColors({ accent: "#f5f5f5", ink: "#f5f5f5", surfaces: ["#121212", "#1f1f1f"], scheme: "dark" });
    expect(failures("white accent", white, ["#121212", "#1f1f1f"])).toEqual([]);
    // a yellow accent on a light skin
    const yellow = switchColors({ accent: "#facc15", ink: "#1a1a18", surfaces: ["#ffffff", "#f5f1eb"], scheme: "light" });
    expect(failures("yellow accent", yellow, ["#ffffff", "#f5f1eb"])).toEqual([]);
    // a navy accent on a near-black skin
    const navy = switchColors({ accent: "#000080", ink: "#ffffff", surfaces: ["#000000", "#0d0d0d"], scheme: "dark" });
    expect(failures("navy accent", navy, ["#000000", "#0d0d0d"])).toEqual([]);
    // no lightness clears a mid grey ground and the thumb at once: an edge does
    const mid = switchColors({ accent: "#3c76f4", ink: "#000000", surfaces: ["#595959"], scheme: "dark" });
    expect(mid.onEdge).not.toBe("transparent");
    expect(failures("mid-tone ground", mid, ["#595959"])).toEqual([]);
  });

  it("holds a brand accent at 3:1 on every skin but Hibou 98", () => {
    const samples: string[] = [];
    for (let h = 0; h < 360; h += 30) for (const l of [25, 50, 75, 92]) samples.push(hsl(h, 85, l));
    samples.push("#000000", "#ffffff", "#777777");
    const problems: string[] = [];
    for (const accent of samples) {
      const vars = brandSwitchVars(accent);
      for (const c of contexts.filter((x) => !x.id.startsWith("retro98"))) {
        const colors = { ...c.colors, on: vars[`--brand-switch-on-${c.scheme}`], onEdge: vars[`--brand-switch-on-edge-${c.scheme}`] };
        problems.push(...failures(`${accent} on ${c.id}`, colors, c.surfaces));
      }
    }
    expect(problems).toEqual([]);
    expect(Object.keys(BRAND_SURFACES)).toEqual(["light", "dark"]);
  });
});

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
