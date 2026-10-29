// My bubble in a bot's colour (2026-10-28): on a skin whose accent is a
// neutral (Midnight's #f5f5f5) the person's bubble was white in every
// conversation. In a 1:1 with a bot it now takes the bot's colour (its hue,
// its text at 4.5:1 or better), whatever "Use bot color as accent" says, and
// the bot's own bubble stays grey. A room keeps the skin's accent, or the
// brand's when the skin's is a neutral.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MASCOT_COLOR_HEX } from "../../shared/mascot-colors";
import { BUBBLE_MIN_CONTRAST, botBubbleVars, isNeutralAccent, roomBubbleColors } from "./bubble-colors";
import { contrastHex, parseHex, toHsl } from "./switch-colors";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const MIDNIGHT_USER = "#f5f5f5";
const hue = (hex: string) => toHsl(parseHex(hex)!)[0];
/** Hue distance on the wheel, 0 to 0.5. */
const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 1 - d);
};

describe("my bubble in a 1:1 takes the bot's colour", () => {
  it("is not Midnight's white, keeps the bot's hue and reads at 4.5:1", () => {
    const css = read("src/styles/skin-bubble.css");
    expect(css).toContain(`--color-bubble-user: var(--brand-bubble-user, ${MIDNIGHT_USER})`);
    for (const bot of ["#ff3b30", "#34c759", "#007aff", "#af52de", "#ff9500"]) {
      const vars = botBubbleVars(bot);
      const user = vars["--color-bubble-user"]!;
      const ink = vars["--color-bubble-user-ink"]!;
      expect(user).not.toBe(MIDNIGHT_USER);
      expect(hueGap(user, bot), `${bot} -> ${user}`).toBeLessThan(0.02);
      expect(contrastHex(user, ink)).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
    }
  });

  it("reads at 4.5:1 for every bot colour", () => {
    for (const [name, hex] of Object.entries(MASCOT_COLOR_HEX)) {
      const vars = botBubbleVars(hex);
      expect(contrastHex(vars["--color-bubble-user"]!, vars["--color-bubble-user-ink"]!), name).toBeGreaterThanOrEqual(BUBBLE_MIN_CONTRAST);
    }
  });

  it("sets only the person's pair, never the bot's grey; nothing for a colour that is not #rrggbb", () => {
    expect(Object.keys(botBubbleVars("#ff3b30")).sort()).toEqual(["--color-bubble-user", "--color-bubble-user-ink"]);
    expect(botBubbleVars(undefined)).toEqual({});
    expect(botBubbleVars("blue")).toEqual({});
  });

  it("is applied where my bubble shows next to a bot, without the accent setting", () => {
    const chat = read("src/components/ChatView.tsx");
    expect(chat).toMatch(/botBubbleVars\(MAUS_COLORS\[bot\.color\]\)/);
    expect(chat).toMatch(/style=\{bubbleStyle\}/);
    expect(read("src/components/code/RunTimeline.tsx")).toMatch(/style=\{botBubbleVars\(botColor\)/);
    expect(read("src/components/code/RunView.tsx")).toMatch(/botColor=\{botColor\}/);
    expect(read("src/components/floating-bots/FloatingBotView.tsx")).toMatch(/botBubbleVars\(owlHex\(snapshot\.color\)\)/);
    // the switch from "Use bot color as accent" never gates it
    expect(chat.slice(chat.indexOf("const bubbleStyle"), chat.indexOf("const bubbleStyle") + 200)).not.toMatch(/accentEnabled|useBotAccentEnabled/);
  });
});

describe("my bubble in a room", () => {
  it("takes the brand's accent on a neutral skin and the skin's otherwise", () => {
    expect(isNeutralAccent(MIDNIGHT_USER)).toBe(true);
    expect(isNeutralAccent("#2e6cf3")).toBe(false);
    expect(roomBubbleColors({ accent: MIDNIGHT_USER, brand: "#2e6cf3" }).user).toBe("#2e6cf3");
    expect(roomBubbleColors({ accent: "#a05f25", brand: "#2e6cf3" }).user).not.toBe("#2e6cf3");
    const css = read("src/styles/skin-bubble.css");
    const at = css.indexOf('[data-skin="midnight"][data-skin="midnight"] [data-room-bubble] {');
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, css.indexOf("}", at))).toContain("var(--brand-bubble-user, #2e6cf3)");
    expect(read("src/components/GroupView.tsx")).toMatch(/data-room-bubble=""/);
  });
});
