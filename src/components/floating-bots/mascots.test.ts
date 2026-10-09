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
import { SHAPE_MOVES } from "@/components/shape-engine";
import { botMascotLook, CHARACTER_PAINT, completeMascotLook, MASCOT_SHAPES, SHAPE_SKINS, TROMBI_SKINS } from "../../../shared/mascot-look";
import { MASCOTS, mascotFor, motion25dTransform, SHAPE_CHOICES, trombiPoseFor } from "./mascots";
import MascotLookEditor, { CHARACTER_LABEL, SHAPE_LABEL, SHAPE_SKIN_LABEL, TROMBI_SKIN_LABEL } from "./MascotLookEditor";
import { REST } from "./clips";

const here = dirname(fileURLToPath(import.meta.url));

function memoryStorage(): FloatingStorage & { removeItem(key: string): void } {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

/** The eyes a shape's fill cuts out: its outline's closed subpaths after the body's own. */
const eyeCuts = (html: string) => {
  const d = /class="shape-fill" d="([^"]+)" fill-rule="evenodd"/.exec(html)?.[1] ?? "";
  return d.split("M").filter(Boolean).slice(1);
};

describe("the eight shapes (stored ids bean, pill, pick and drop)", () => {
  const coords = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  it("stands the triangle on its base and points the droplet up", () => {
    const tri = coords(SHAPE_ART.pick.d);
    const top = tri.reduce((best, p) => (p[1] < best[1] ? p : best));
    expect(Math.abs(top[0] - 50)).toBeLessThan(2);
    const drop = coords(SHAPE_ART.drop.d);
    const tip = drop.reduce((best, p) => (p[1] < best[1] ? p : best));
    expect(Math.abs(tip[0] - 50)).toBeLessThan(2);
    expect(tip[1]).toBeLessThan(12);
  });
  it("lays the capsule down: wider than tall", () => {
    const pts = coords(SHAPE_ART.pill.d);
    const width = Math.max(...pts.map(([x]) => x)) - Math.min(...pts.map(([x]) => x));
    const height = Math.max(...pts.map(([, y]) => y)) - Math.min(...pts.map(([, y]) => y));
    expect(width / height).toBeGreaterThan(1.5);
  });
});

describe("a bot's character and its look", () => {
  it("is one of the owl, the eight shapes or Trombi, the owl when absent or malformed", () => {
    expect(MASCOT_SHAPES).toEqual(["circle", "bean", "squircle", "pill", "pick", "hexagon", "cloud", "drop"]);
    // a look stored with a shape of an earlier set keeps working, on the nearest of the eight
    expect(botMascotLook({ character: "shape", shape: "blob" })).toEqual({ character: "shape", shape: "bean" });
    expect(botMascotLook({ character: "shape", shape: "triangle" })).toEqual({ character: "shape", shape: "pick" });
    for (const [old, now] of [["sparkle", "squircle"], ["clover", "cloud"], ["flower", "cloud"], ["house", "hexagon"], ["star", "hexagon"], ["droplet", "drop"], ["capsule", "pill"], ["pebble", "bean"]]) {
      expect(botMascotLook({ character: "shape", shape: old })).toEqual({ character: "shape", shape: now });
    }
    expect(botMascotLook({ character: "shape", shape: "constructor" })).toEqual({ character: "owl" });
    expect(botMascotLook(undefined)).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "shape", shape: "rocket" })).toEqual({ character: "owl" });
    expect(botMascotLook({ character: "trombi", skins: { trombi: "gold" } })).toEqual({ character: "trombi", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "shape" })).toEqual({ character: "shape", style: "2d", shape: "circle", skins: { shape: "plain", trombi: "classic", bunbu: "plain", shiba: "plain", frog: "plain" } });
  });

  it("keeps each character's own skin when switching and back", () => {
    const look = completeMascotLook({ character: "shape", skins: { shape: "neon", trombi: "retro98" } });
    const trombi = { ...look, character: "trombi" as const };
    expect(completeMascotLook({ ...trombi, character: "shape" }).skins).toEqual({ shape: "neon", trombi: "retro98", bunbu: "plain", shiba: "plain", frog: "plain" });
  });

  it("draws every shape, with every skin, with two eyes cut through the body", () => {
    for (const shape of MASCOT_SHAPES) {
      expect(SHAPE_ART[shape].d).toMatch(/^M/);
      for (const skin of SHAPE_SKINS) {
        const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "shape", shape, skins: { shape: skin } } }, size: 40 }));
        expect(html).toContain(`data-shape="${shape}"`);
        expect(html).toContain(`data-shape-skin="${skin}"`);
        expect(eyeCuts(html), `${shape} ${skin}`).toHaveLength(2);
        expect(shapeSkinPaint(skin, "#377FE6").fill).toMatch(/^#/);
      }
    }
  });

  it("gives every shape the same resting face: rounded bars about twice as tall as wide, the right one a little higher", () => {
    for (const shape of MASCOT_SHAPES) {
      const html = renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "white", mascotLook: { character: "shape", shape } }, size: 60, animated: false }));
      const eyes = eyeCuts(html).map((d) => {
        const pts = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        const xs = pts.map(([x]) => x);
        const ys = pts.map(([, y]) => y);
        return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), y: (Math.max(...ys) + Math.min(...ys)) / 2, x: (Math.max(...xs) + Math.min(...xs)) / 2 };
      });
      expect(eyes, shape).toHaveLength(2);
      const [left, right] = eyes;
      expect(left.x).toBeLessThan(right.x);
      expect(right.y, shape).toBeLessThan(left.y);
      for (const eye of eyes) expect(eye.h / eye.w, shape).toBeGreaterThan(1.4);
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
    expect(MASCOTS.map((entry) => entry.id)).toEqual(["owl", "shape", "trombi", "bunbu", "shiba", "frog"]);
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
    // the Mastery characters (Shiba, Frog) stay in the row, locked, with their achievement; nothing else shows locked
    expect(locked).toContain('data-character-option="shiba"');
    expect(locked).toContain('data-character-option="frog"');
    expect(locked.match(/data-locked/g) ?? []).toHaveLength(2);
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
    // the fourteen Shapes moves, in order, each named
    const moves = [...html.matchAll(/data-character-move="([a-z]+)"/g)].map((m) => m[1]);
    expect(moves).toEqual([...SHAPE_MOVES]);
    expect(moves).toHaveLength(14);
    for (const move of SHAPE_MOVES) expect(html).toContain(`aria-label="Play the ${(en as Record<string, string>)[`mascot.shapeMove.${move}`]} move"`);
    // eight shapes, each named
    expect([...html.matchAll(/data-character-shape="([a-z]+)"/g)].map((m) => m[1])).toEqual([...MASCOT_SHAPES]);
    expect(html).toContain('aria-label="Pebble"');
    expect(html).toContain('aria-label="Droplet"');
    // Clay is the first skin and the Clay palette is offered
    expect(html).toContain('data-shape-skin-option="plain"');
    expect(html).toContain('data-tab="clay"');
  });

  it("offers Trombi his skins and moves only, no colors", () => {
    const html = render({ character: "trombi" });
    for (const skin of TROMBI_SKINS) expect(render({ character: "trombi", skins: { trombi: skin } })).toContain(`data-trombi-skin-option="${skin}"`);
    expect(html).not.toContain("mascot color");
    expect((html.match(/data-character-move=/g) ?? []).length).toBe(MASCOTS.find((entry) => entry.id === "trombi")!.moves.length);
  });
});

describe("the moves a character plays on request (the popover's Moves, the desktop menu's Moves)", () => {
  it("gives the owl its wing moves and every other character its registry list, each a timed clip with a name", async () => {
    const { characterMoves, isMoveClip } = await import("./moves");
    const { MASCOTS } = await import("./mascots");
    expect(characterMoves(undefined).map((move) => move.clip)).toEqual(["wave", "hop", "jump", "dance", "hoot"]);
    expect(characterMoves({ character: "owl" }).every((move) => move.owl)).toBe(true);
    for (const entry of MASCOTS.filter((candidate) => candidate.id !== "owl")) {
      const moves = characterMoves({ character: entry.id });
      expect(moves.map((move) => move.clip)).toEqual([...entry.moves]);
      for (const move of moves) {
        // the Shapes moves play in the Shapes engine, not as behavior clips (the desktop menu leaves them out)
        if (entry.id === "shape") {
          expect(move.label).toMatch(/^mascot\.shapeMove\./);
          continue;
        }
        expect(isMoveClip(move.clip)).toBe(true);
        expect(move.label).toMatch(/^(floatingBots\.move|mascot\.motion)\./);
      }
    }
    expect(isMoveClip("sleep")).toBe(false);
  });
});

describe("the drawn menu (in-app overlay)", () => {
  it("lists a submenu's items after its title, indented", async () => {
    const { drawnMenuRows } = await import("./FloatingBotView");
    const rows = drawnMenuRows([{ id: "balloon", label: "Talk" }, { id: "sep-1", label: "", type: "separator" }, { id: "moves", label: "Moves", items: [{ id: "move:wave", label: "Wave" }] }]);
    expect(rows.map(({ item, depth }) => `${depth}:${item.id}`)).toEqual(["0:balloon", "0:sep-1", "0:moves", "1:move:wave"]);
  });
});
