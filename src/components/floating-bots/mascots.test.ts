import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { resetAchievementsForTests } from "@/lib/achievements";
import { forgetLegacyBotLooks, readLegacyBotLooks, type FloatingStorage } from "@/lib/floating-bots";
import { setGrokAccountLinked } from "@/lib/grok-account";
import type { AchievementSnapshot } from "../../../shared/achievements";
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

describe("the heart and the triangle (stored ids bean and pick)", () => {
  const coords = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  it("draws the heart symmetric, lobes on top and its point at the bottom", () => {
    const points = coords(SHAPE_ART.bean.d);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    expect(Math.abs(Math.min(...xs) + Math.max(...xs) - 100)).toBeLessThan(1);
    const bottom = points.reduce((low, p) => (p[1] > low[1] ? p : low));
    expect(Math.abs(bottom[0] - 50)).toBeLessThan(2);
    expect(Math.min(...ys)).toBeLessThan(15);
    expect(SHAPE_ART.bean.face[0]).toBe(50);
  });
  it("draws the triangle with three rounded corners and its face in the upper middle", () => {
    expect((SHAPE_ART.pick.d.match(/Q/g) ?? []).length).toBe(3);
    expect(SHAPE_ART.pick.face[1]).toBeLessThan(62);
    expect(SHAPE_ART.pick.face[1]).toBeGreaterThan(48);
  });
  it("draws the teardrop as a soft drop, point toward the top left and a round belly", () => {
    const d = SHAPE_ART.drop.d;
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("C");
    expect(d).not.toMatch(/A\d/);
    const nums = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const on = [nums[0], ...nums.filter((_, index) => index > 0 && index % 3 === 0)];
    const minX = Math.min(...on.map(([x]) => x));
    const maxX = Math.max(...on.map(([x]) => x));
    const top = on.reduce((best, point) => (point[1] < best[1] ? point : best));
    expect(top[0]).toBeLessThan((minX + maxX) / 2);
    expect(top[0]).toBeGreaterThan(minX + 4);
    expect(SHAPE_ART.drop.face).toEqual([57, 54]);
  });
});

describe("a bot's character and its look", () => {
  it("is one of the owl, the thirteen original shapes or Trombi, the owl when absent or malformed", () => {
    expect(MASCOT_SHAPES).toEqual(["circle", "cloud", "squircle", "sparkle", "clover", "bean", "flower", "drop", "pill", "pick", "house", "star", "hexagon"]);
    // a look stored with a shape of the first set keeps working
    expect(botMascotLook({ character: "shape", shape: "blob" })).toEqual({ character: "shape", shape: "bean" });
    expect(botMascotLook({ character: "shape", shape: "triangle" })).toEqual({ character: "shape", shape: "pick" });
    expect(botMascotLook(undefined)).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "shape", shape: "rocket" })).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "trombi", skins: { trombi: "gold" } })).toEqual({ character: "trombi", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "shape" })).toEqual({ character: "shape", style: "2d", shape: "circle", skins: { shape: "plain", trombi: "classic", bunbu: "plain" } });
  });

  it("keeps each character's own skin when switching and back", () => {
    const look = completeMascotLook({ character: "shape", skins: { shape: "neon", trombi: "retro98" } });
    const trombi = { ...look, character: "trombi" as const };
    expect(completeMascotLook({ ...trombi, character: "shape" }).skins).toEqual({ shape: "neon", trombi: "retro98", bunbu: "plain" });
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

  it("gives every shape exactly the same eyes: same ovals, same tilt, same spacing, only the anchor moves", () => {
    const faces = MASCOT_SHAPES.map((shape) => {
      const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "white", mascotLook: { character: "shape", shape } }, size: 60, animated: false }));
      const eyes = [...html.matchAll(/<ellipse class="shape-eye" cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.]+)" ry="([\d.]+)" transform="rotate\(([\d.]+)/g)].map((m) => m.slice(1).map(Number));
      expect(eyes, shape).toHaveLength(2);
      const [[lx, ly, lrx, lry, lt], [rx, ry, rrx, rry, rt]] = eyes;
      return { size: [lrx, lry, rrx, rry], tilt: [lt, rt], gap: [rx - lx, ry - ly] };
    });
    for (const face of faces) expect(face).toEqual(faces[0]);
    expect(faces[0].size[1] / faces[0].size[0]).toBeCloseTo(2.2, 1);
    // the right eye sits a little higher
    expect(faces[0].gap[1]).toBeLessThan(0);
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
    const allowed = new Set(["Avatar.tsx", "OwlAvatar.tsx", "OwlSkinFx.tsx", "mascots.tsx", "MascotLookEditor.tsx", "FloatingBotWindow.tsx", "AssistantArt.tsx", "RetroAssistant.tsx", "Owl25D.tsx", "CursorAvatar.tsx",
      // an achievement reward's skin preview (the toast, the achievements page), not a bot
      "RewardPreview.tsx"]);
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
    expect(MASCOTS.map((entry) => entry.id)).toEqual(["owl", "shape", "trombi", "bunbu"]);
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
  const render = (mascotLook?: Parameters<typeof botMascotLook>[0], mascotSkin = "none") =>
    renderToStaticMarkup(createElement(MascotLookEditor, { bot: { color: "blue", mascotSkin: mascotSkin as never, mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined }));
  const enforce = (rewards: string[]) => resetAchievementsForTests({ status: "ready", snapshot: { rewards, items: [] } as unknown as AchievementSnapshot });

  afterEach(() => {
    resetAchievementsForTests();
    setGrokAccountLinked(false);
  });

  it("offers the owl its colors, skins and wing moves when nothing is locked", () => {
    const html = render(undefined);
    for (const id of ["owl", "shape", "trombi"]) expect(html).toContain(`data-character-option="${id}"`);
    expect(html).toContain('data-character-options="owl"');
    // the skins open on the current one's rarity (none: Common), one tab per rarity
    for (const skin of ["none", "snowy", "barn", "carbon"]) expect(html).toContain(`data-mascot-skin-option="${skin}"`);
    expect(html).not.toContain('data-mascot-skin-option="frost"');
    for (const tier of ["common", "rare", "epic", "legendary"]) expect(html).toMatch(new RegExp(`role="tab"[^>]*data-tab="${tier}"`));
    expect(html).toContain("data-color-tabs");
    expect(html).not.toContain("data-character-style");
    expect(html).toContain('data-character-move="spread-wings"');
    expect(html).not.toContain("data-character-shape");
  });

  it("hides locked characters and skins, and shows Shapes once a Grok account is linked", () => {
    enforce([]);
    const locked = render(undefined);
    expect(locked).toContain('data-character-option="owl"');
    for (const id of ["shape", "trombi", "bunbu"]) expect(locked).not.toContain(`data-character-option="${id}"`);
    expect(locked).not.toContain("data-locked");
    expect(locked).not.toContain('data-tab="epic"');
    expect(locked).toContain('data-mascot-skin-option="none"');
    // the skin this bot already wears stays visible
    expect(render(undefined, "chrome")).toContain('data-mascot-skin-option="chrome"');
    expect(render(undefined, "chrome")).not.toContain('data-mascot-skin-option="lightning"');
    setGrokAccountLinked(true);
    const linked = render(undefined);
    expect(linked).toContain('data-character-option="shape"');
    expect(linked).not.toContain('data-character-option="trombi"');
    setGrokAccountLinked(false);
    enforce(["character:trombi", "character:bunbu", "skin:owl:chrome"]);
    const earned = render(undefined);
    expect(earned).toContain('data-character-option="trombi"');
    expect(earned).toContain('data-character-option="bunbu"');
    expect(earned).not.toContain('data-character-option="shape"');
    expect(earned).toContain('data-tab="epic"');
  });

  it("offers a shape its shapes, colors, skins by rarity and its own moves, and nothing of the owl", () => {
    const html = render({ character: "shape", shape: "cloud" });
    for (const shape of MASCOT_SHAPES) expect(html).toContain(`data-character-shape="${shape}"`);
    for (const skin of SHAPE_SKINS) {
      const open = render({ character: "shape", shape: "cloud", skins: { shape: skin } });
      expect(open, skin).toContain(`data-shape-skin-option="${skin}"`);
    }
    expect(html).not.toContain("data-mascot-skin-option");
    expect(html).not.toContain('data-character-move="spread-wings"');
    expect(html).toContain('data-character-move="dance"');
  });

  it("offers Trombi his skins and moves only, no colors", () => {
    const html = render({ character: "trombi" });
    for (const skin of TROMBI_SKINS) expect(render({ character: "trombi", skins: { trombi: skin } })).toContain(`data-trombi-skin-option="${skin}"`);
    expect(html).not.toContain("mascot color");
    expect((html.match(/data-character-move=/g) ?? []).length).toBe(MASCOTS.find((entry) => entry.id === "trombi")!.moves.length);
  });
});
