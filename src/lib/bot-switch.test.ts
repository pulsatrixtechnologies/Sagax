// The switches in a bot's panel (2026-10-28): the on track takes the bot's
// colour, at 3:1 with the thumb and with every surface, for every colour a
// bot can have; outside the panel, and with no bot, nothing changes.
// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { botSwitchActive } from "./bot-accent";
import { BOT_SWITCH_VARS, BRAND_SURFACES, botSwitchVars, SWITCH_MIN_CONTRAST, switchContrasts, type Scheme, type SwitchColors } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
type Context = { id: string; selector: string; scheme: Scheme; surfaces: string[]; colors: SwitchColors };
let contexts: Context[];
const css = readFileSync(join(ROOT, "src/styles/skin-switch.css"), "utf8");

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(ROOT, "scripts", "gen-switch-tokens.mjs")).href)) as { switchContexts: () => Context[] };
  contexts = mod.switchContexts();
});

const base = { hasBot: true, activeView: "chat", appSettingsOpen: false, pluginsOpen: false, accentEnabled: false };

describe("botSwitchActive", () => {
  it("is on in the bot's chat, routines and tasks, whatever the accent setting says", () => {
    for (const activeView of ["chat", "routines", "code"]) expect(botSwitchActive({ ...base, activeView })).toBe(true);
  });
  it("is off outside the bot's panel: app settings, plugins, team map, approvals", () => {
    expect(botSwitchActive({ ...base, appSettingsOpen: true })).toBe(false);
    expect(botSwitchActive({ ...base, pluginsOpen: true })).toBe(false);
    for (const activeView of ["team-map", "approvals", "remote-sessions", "achievements"]) expect(botSwitchActive({ ...base, activeView })).toBe(false);
  });
  it("is off with no bot", () => {
    expect(botSwitchActive({ ...base, hasBot: false, accentEnabled: true })).toBe(false);
  });
  it("follows the bot everywhere once 'Use bot color as accent' is on", () => {
    expect(botSwitchActive({ ...base, activeView: "team-map", appSettingsOpen: true, accentEnabled: true })).toBe(true);
  });
});

describe("botSwitchVars", () => {
  it("derives the on track from the bot's colour, keeping its hue", () => {
    const vars = botSwitchVars(MASCOT_COLOR_HEX.red);
    expect(Object.keys(vars).sort()).toEqual([...BOT_SWITCH_VARS].sort());
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(vars["--bot-switch-on-dark"].slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
  it("is empty for something that is not a colour", () => {
    expect(botSwitchVars(null)).toEqual({});
    expect(botSwitchVars("red")).toEqual({});
  });
  it("holds 3:1 with the thumb and with every surface, for every bot colour on every skin", () => {
    const problems: string[] = [];
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const vars = botSwitchVars(hex);
      for (const c of contexts) {
        const colors = { ...c.colors, on: vars[`--bot-switch-on-${c.scheme}`], onEdge: vars[`--bot-switch-on-edge-${c.scheme}`] };
        const m = switchContrasts(colors, c.surfaces);
        for (const key of ["thumbOn", "onGround"] as const) if (m[key] < SWITCH_MIN_CONTRAST) problems.push(`${name} on ${c.id}: ${key} ${m[key].toFixed(2)}`);
      }
    }
    expect(problems).toEqual([]);
    expect(Object.keys(BRAND_SURFACES)).toEqual(["light", "dark"]);
  });
});

describe("the stylesheet", () => {
  it("applies the bot's track only under body[data-bot-switch], in each skin's own scheme", () => {
    const lightGroup = css.slice(css.indexOf(":is("), css.indexOf("body[data-bot-switch] {\n  --color-switch-on: var(--bot-switch-on-light)"));
    for (const c of contexts) {
      const group = c.scheme === "light" ? lightGroup : css.slice(css.indexOf(lightGroup) + lightGroup.length);
      expect(group, c.id).toContain(c.selector);
    }
    expect(css).toContain("--color-switch-on: var(--bot-switch-on-light);");
    expect(css).toContain("--color-switch-on: var(--bot-switch-on-dark);");
  });
  it("leaves the skin's own tracks untouched outside the panel: every bot rule is scoped to the body attribute", () => {
    const rules = css.split("\n").filter((line) => line.includes("--bot-switch"));
    expect(rules.length).toBeGreaterThan(0);
    const botBlocks = css.split("\n\n").filter((block) => block.includes("--bot-switch"));
    for (const block of botBlocks) expect(block).toContain("body[data-bot-switch]");
  });
  it("is read from the bot's variables on body, which the app clears outside the panel", () => {
    document.body.dataset.botSwitch = "";
    for (const [k, v] of Object.entries(botSwitchVars("#3b93f0"))) document.body.style.setProperty(k, v);
    expect(document.body.style.getPropertyValue("--bot-switch-on-dark")).toMatch(/^#[0-9a-f]{6}$/);
    for (const name of BOT_SWITCH_VARS) document.body.style.removeProperty(name);
    delete document.body.dataset.botSwitch;
    expect(document.body.hasAttribute("data-bot-switch")).toBe(false);
  });
});
