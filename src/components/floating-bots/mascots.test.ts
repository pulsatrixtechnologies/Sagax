import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { botMascots, cleanMascotChoice, MASCOT_KIND_PAINT, readBotMascots, resetFloatingBotsForTests, setBotMascot, setFloatingBotMascot, type FloatingStorage } from "@/lib/floating-bots";
import CharacterSection from "./CharacterSection";
import { MASCOT_BODY_IDS } from "../../../shared/mascot-bodies";
import { BODY_CHOICES, cursorStateFor, MASCOTS, mascotFor, motion25dTransform, nextMascot, trombiPoseFor } from "./mascots";
import { REST } from "./clips";
import { isFloatingEvent } from "./protocol";


function memoryStorage(): FloatingStorage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

beforeEach(() => resetFloatingBotsForTests());

describe("the desktop mascot registry", () => {
  it("lists each character once, with a renderer, a thumbnail and its capabilities", () => {
    const ids = MASCOTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["owl", "body", "trombi"]);
    for (const entry of MASCOTS) {
      expect(typeof entry.Render).toBe("function");
      expect(typeof entry.Thumb).toBe("function");
      expect(Object.keys(entry.capabilities).sort()).toEqual(["blink", "flip", "fly", "turn", "walk", "wings"]);
    }
    // only the owl has wings; the others hop across instead of flying
    expect(MASCOTS.filter((entry) => entry.capabilities.wings).map((entry) => entry.id)).toEqual(["owl"]);
  });

  it("has an English and a French name for every character and every original shape", () => {
    for (const id of ["owl", "body", "trombi"]) {
      expect(en).toHaveProperty([`floatingBots.mascot.${id}`]);
      expect(fr).toHaveProperty([`floatingBots.mascot.${id}`]);
    }
    for (const id of MASCOT_BODY_IDS) {
      expect(en).toHaveProperty([`floatingBots.body.${id}`]);
      expect(fr).toHaveProperty([`floatingBots.body.${id}`]);
    }
    expect(BODY_CHOICES).toEqual(MASCOT_BODY_IDS);
  });

  it("falls back to the owl, and cycles the characters from the menu", () => {
    expect(mascotFor(undefined).id).toBe("owl");
    expect(mascotFor({ kind: "trombi" }).id).toBe("trombi");
    expect(nextMascot({ kind: "owl", style: "3d" })).toEqual({ kind: "body", style: "3d" });
    expect(nextMascot({ kind: "trombi" }).kind).toBe("owl");
  });

  it("maps the clips each renderer can show", () => {
    expect(cursorStateFor("sleep", "idle")).toBe("sleeping");
    expect(cursorStateFor("idle", "think")).toBe("thinking");
    expect(trombiPoseFor("fly", "idle")).toBe("send");
    expect(trombiPoseFor("celebrate", "idle")).toBe("celebrate");
    // a one-piece character never turns in depth either
    expect(motion25dTransform({ ...REST, spin: 2, flip: 3, roll: 1 }, 120)).not.toMatch(/rotate[XYZ]\(/);
  });
});

describe("the mascot choice is saved per bot", () => {
  it("keeps a well-formed choice per bot, floated or not, in one place for the tab, the menu and the popover", () => {
    const storage = memoryStorage();
    setBotMascot("bot_a", { kind: "body", body: "star" }, storage);
    setFloatingBotMascot("bot_b", { kind: "trombi" }, storage);
    setBotMascot("bot_c", { kind: "dragon" as never }, storage);
    setBotMascot("../x", { kind: "owl" }, storage);
    expect(readBotMascots(storage)).toEqual({ bot_a: { kind: "body", body: "star" }, bot_b: { kind: "trombi" } });
    expect(botMascots().bot_a).toEqual({ kind: "body", body: "star" });
    expect(cleanMascotChoice({ kind: "owl", style: "3d", body: "../x" })).toEqual({ kind: "owl", style: "3d" });
    expect(isFloatingEvent({ type: "mascot", choice: { kind: "trombi" } })).toBe(true);
    expect(isFloatingEvent({ type: "mascot", choice: { kind: "x" } })).toBe(false);
  });
});

describe("the avatar popover's Character section", () => {
  it("offers only what each character supports, as the registry says", () => {
    for (const entry of MASCOTS) {
      expect(MASCOT_KIND_PAINT[entry.id].colors).toBe(entry.paint.colors);
      expect(MASCOT_KIND_PAINT[entry.id].skins).toBe(entry.paint.skins);
      expect(MASCOT_KIND_PAINT[entry.id].wingMoves).toBe(entry.capabilities.wings);
    }
  });

  it("lists the characters, the shapes of the original family, and that character's own moves", () => {
    setBotMascot("bot_p", { kind: "body", body: "drop" }, memoryStorage());
    const html = renderToStaticMarkup(createElement(CharacterSection, { botId: "bot_p", color: "blue", skin: "none" }));
    for (const id of ["owl", "body", "trombi"]) expect(html).toContain(`data-character-option="${id}"`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-character-option="body"/);
    for (const id of MASCOT_BODY_IDS) expect(html).toContain(`data-character-shape="${id}"`);
    for (const move of MASCOTS.find((entry) => entry.id === "body")!.moves) expect(html).toContain(`data-character-move="${move}"`);
    const owl = renderToStaticMarkup(createElement(CharacterSection, { botId: "bot_none", color: "blue", skin: "none" }));
    expect(owl).toContain('data-character-style="3d"');
    expect(owl).not.toContain("data-character-move");
  });
});
