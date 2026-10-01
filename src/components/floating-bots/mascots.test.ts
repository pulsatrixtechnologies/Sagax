import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { forgetLegacyBotLooks, readLegacyBotLooks, type FloatingStorage } from "@/lib/floating-bots";
import { BotAvatar } from "@/components/Avatar";
import { SHAPE_ART, shapeSkinPaint } from "@/components/ShapeMascot";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, MASCOT_SHAPES, SHAPE_SKINS, TROMBI_SKINS } from "../../../shared/mascot-look";
import { MASCOTS, mascotFor, motion25dTransform, SHAPE_CHOICES, trombiPoseFor } from "./mascots";
import MascotLookEditor, { CHARACTER_LABEL, SHAPE_LABEL, SHAPE_SKIN_LABEL, TROMBI_SKIN_LABEL } from "./MascotLookEditor";
import { REST } from "./clips";

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): FloatingStorage & { removeItem(key: string): void } {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

describe("a bot's character and its look", () => {
  it("is one of the owl, the eight original shapes or Trombi, the owl when absent or malformed", () => {
    expect(MASCOT_SHAPES).toEqual(["circle", "blob", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"]);
    expect(botMascotLook(undefined)).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "shape", shape: "star" })).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "trombi", skins: { trombi: "gold" } })).toEqual({ character: "trombi", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "shape" })).toEqual({ character: "shape", style: "2d", shape: "circle", skins: { shape: "plain", trombi: "classic" } });
  });

  it("keeps each character's own skin when switching and back", () => {
    const look = completeMascotLook({ character: "shape", skins: { shape: "neon", trombi: "retro98" } });
    const trombi = { ...look, character: "trombi" as const };
    expect(completeMascotLook({ ...trombi, character: "shape" }).skins).toEqual({ shape: "neon", trombi: "retro98" });
  });

  it("draws every shape, with every skin, with two eyes", () => {
    for (const shape of MASCOT_SHAPES) {
      expect(SHAPE_ART[shape].d).toMatch(/^M/);
      for (const skin of SHAPE_SKINS) {
        const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "shape", shape, skins: { shape: skin } } }, size: 40 }));
        expect(html).toContain(`data-shape="${shape}"`);
        expect(html).toContain(`data-shape-skin="${skin}"`);
        expect((html.match(/class="shape-eye"/g) ?? []).length).toBe(2);
        expect(shapeSkinPaint(skin, "#377FE6").fill).toMatch(/^#/);
      }
    }
  });

  it("is what every bot avatar in the app shows: the owl, a shape, or Trombi", () => {
    const owl = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green" }, size: 40 }));
    expect(owl).toContain("data-owl");
    const trombi = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "green", mascotLook: { character: "trombi", skins: { trombi: "gold" } } }, size: 40 }));
    expect(trombi).toContain("r98-trombi");
    expect(trombi).toContain("trombi-skin-gold");
  });

  it("is drawn through BotAvatar at every bot avatar call site", () => {
    // a bot's mascot is never drawn straight from the owl or the old cursor body outside these files
    const allowed = new Set(["Avatar.tsx", "OwlAvatar.tsx", "OwlSkinFx.tsx", "mascots.tsx", "MascotLookEditor.tsx", "FloatingBotWindow.tsx", "AssistantArt.tsx", "RetroAssistant.tsx", "Owl25D.tsx", "CursorAvatar.tsx"]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "onboarding") walk(path);
        } else if (name.endsWith(".tsx") && !name.includes(".test.") && !allowed.has(name)) {
          if (/<(MausAvatar|OwlAvatar|CursorAvatar)\b/.test(readFileSync(path, "utf8"))) offenders.push(name);
        }
      }
    };
    walk(join(here, ".."));
    expect(offenders).toEqual([]);
  });

  it("moves from the old per-device record onto the bots, once", () => {
    const storage = memoryStorage();
    storage.setItem("omb.botMascots.v1", JSON.stringify({ bot_a: { kind: "body", body: "capsule" }, bot_b: { kind: "owl", style: "3d" }, bot_c: { kind: "trombi" }, "../x": { kind: "owl" } }));
    expect(readLegacyBotLooks(storage)).toEqual({
      bot_a: { character: "shape", shape: "pill" },
      bot_b: { character: "owl", style: "3d" },
      bot_c: { character: "trombi" },
    });
    forgetLegacyBotLooks(storage);
    expect(readLegacyBotLooks(storage)).toEqual({});
  });
});

describe("the mascot registry", () => {
  it("lists each character once, with a renderer, a thumbnail and its capabilities", () => {
    expect(MASCOTS.map((entry) => entry.id)).toEqual(["owl", "shape", "trombi"]);
    for (const entry of MASCOTS) {
      expect(typeof entry.Render).toBe("function");
      expect(typeof entry.Thumb).toBe("function");
      expect(entry.capabilities.wings).toBe(CHARACTER_PAINT[entry.id].wingMoves);
      expect(entry.paint.colors).toBe(CHARACTER_PAINT[entry.id].colors);
    }
    expect(mascotFor(undefined).id).toBe("owl");
    expect(SHAPE_CHOICES).toEqual(MASCOT_SHAPES);
  });

  it("has English and French names for every character, shape and skin", () => {
    const keys = [...Object.values(CHARACTER_LABEL), ...Object.values(SHAPE_LABEL), ...Object.values(SHAPE_SKIN_LABEL), ...Object.values(TROMBI_SKIN_LABEL)];
    for (const key of keys) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
    expect(Object.keys(SHAPE_SKIN_LABEL)).toEqual([...SHAPE_SKINS]);
    expect(Object.keys(TROMBI_SKIN_LABEL)).toEqual([...TROMBI_SKINS]);
  });

  it("maps the clips each renderer can show, and never turns a flat one in depth", () => {
    expect(trombiPoseFor("fly", "idle")).toBe("send");
    expect(motion25dTransform({ ...REST, spin: 2, flip: 3, roll: 1 }, 120)).not.toMatch(/rotate[XYZ]\(/);
  });
});

describe("the avatar popover's Bot tab", () => {
  const render = (mascotLook?: Parameters<typeof botMascotLook>[0]) =>
    renderToStaticMarkup(createElement(MascotLookEditor, { bot: { color: "blue", mascotSkin: "none", mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined }));

  it("offers the owl its colors, skins, style and wing moves", () => {
    const html = render(undefined);
    for (const id of ["owl", "shape", "trombi"]) expect(html).toContain(`data-character-option="${id}"`);
    expect(html).toContain('data-character-options="owl"');
    expect(html).toContain('data-mascot-skin-option="frost"');
    expect(html).toContain('data-character-style="3d"');
    expect(html).toContain('data-character-move="spread-wings"');
    expect(html).not.toContain("data-character-shape");
  });

  it("offers a shape its eight shapes, colors, six skins and its own moves, and nothing of the owl", () => {
    const html = render({ character: "shape", shape: "cloud" });
    for (const shape of MASCOT_SHAPES) expect(html).toContain(`data-character-shape="${shape}"`);
    for (const skin of SHAPE_SKINS) expect(html).toContain(`data-shape-skin-option="${skin}"`);
    expect(html).not.toContain("data-mascot-skin-option");
    expect(html).not.toContain('data-character-move="spread-wings"');
    expect(html).toContain('data-character-move="dance"');
  });

  it("offers Trombi his skins and moves only, no colors", () => {
    const html = render({ character: "trombi" });
    for (const skin of TROMBI_SKINS) expect(html).toContain(`data-trombi-skin-option="${skin}"`);
    expect(html).not.toContain("mascot color");
    expect((html.match(/data-character-move=/g) ?? []).length).toBe(MASCOTS.find((entry) => entry.id === "trombi")!.moves.length);
  });
});
