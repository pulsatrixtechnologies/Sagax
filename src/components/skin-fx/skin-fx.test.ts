import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BotAvatar } from "@/components/Avatar";
import { ShapeMascot } from "@/components/ShapeMascot";
import { botMascotLook, completeMascotLook, LEGACY_SHAPE_SKINS, LEGACY_TROMBI_SKINS, SHAPE_SKIN_TIER, SHAPE_SKINS, TROMBI_SKIN_TIER, TROMBI_SKINS } from "../../../shared/mascot-look";
import MascotLookEditor, { SKIN_TIER_LABEL } from "../floating-bots/MascotLookEditor";
import { SkinnedTrombi } from "./SkinnedTrombi";
import { fxDetail, fxMoveFor, FX_FULL_MIN } from "./skin-fx";
import { MoveFx } from "./SkinFx";
import { fxPalette } from "./skin-fx";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "skin-fx.css"), "utf8");
const shape = (skin: string, size: number, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "shape", shape: "star", skins: { shape: skin } } } as never, size, ...extra }));
const trombi = (skin: string, size: number, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BotAvatar, { bot: { color: "blue", mascotLook: { character: "trombi", skins: { trombi: skin } } } as never, size, ...extra }));

describe("premium skins render at every size", () => {
  it("draws every shape skin full when large and animated, still (no filter, nothing live) when small", () => {
    for (const skin of SHAPE_SKINS) {
      const big = shape(skin, 112);
      expect(big, skin).toContain(`data-shape-skin="${skin}"`);
      expect(big).toContain(`data-skin-tier="${SHAPE_SKIN_TIER[skin]}"`);
      expect(big).toContain('data-fx="full"');
      expect(big).toContain("skin-fx-live");
      expect((big.match(/class="shape-eye"/g) ?? []).length).toBe(2);
      const small = shape(skin, 24);
      expect(small).toContain('data-fx="static"');
      expect(small).not.toContain("skin-fx-live");
      expect(small).not.toContain("<filter");
      expect(small).not.toMatch(/class="fx-(boil|current|pulse|ember|heat|twinkle|glint)/);
      expect((small.match(/class="shape-eye"/g) ?? []).length).toBe(2);
      // a thumbnail (not animated) is still too
      expect(shape(skin, 112, { animated: false })).toContain('data-fx="static"');
    }
  });

  it("keeps the eyes identical on every skin: same ovals, same place", () => {
    const eyes = (skin: string) => [...shape(skin, 60, { animated: false }).matchAll(/<ellipse class="shape-eye" cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.]+)" ry="([\d.]+)"/g)].map((m) => m.slice(1).join(","));
    const plain = eyes("plain");
    for (const skin of SHAPE_SKINS) expect(eyes(skin), skin).toEqual(plain);
  });

  it("draws every Trombi skin, full when large, still when small, with his own eyes", () => {
    for (const skin of TROMBI_SKINS) {
      const big = trombi(skin, 112);
      expect(big, skin).toContain(`trombi-skin-${skin}`);
      expect(big).toContain(`data-skin-tier="${TROMBI_SKIN_TIER[skin]}"`);
      expect(big).toContain('data-fx="full"');
      expect((big.match(/data-part="eye-[LR]"/g) ?? []).length).toBe(2);
      const small = trombi(skin, 24);
      expect(small).toContain('data-fx="static"');
      expect(small).not.toContain("skin-fx-live");
    }
    // the desktop mascot and the skin cards ask for the full version at any size
    expect(renderToStaticMarkup(createElement(SkinnedTrombi, { skin: "molten", pose: "idle", size: 30, width: 24, detail: "full" }))).toContain('data-fx="full"');
    expect(fxDetail(FX_FULL_MIN - 1, true)).toBe("static");
    expect(fxDetail(FX_FULL_MIN, true)).toBe("full");
  });

  it("has a burst for every move, in the skin's colors", () => {
    for (const move of ["wave", "dance", "jump", "hop", "love", "hoot"] as const) {
      expect(fxMoveFor(move)).toBe(move);
      const html = renderToStaticMarkup(createElement(MoveFx, { move, palette: fxPalette("neon", "#377FE6"), uid: "t", path: "M0 0Z" }));
      expect(html).toContain(`fx-move-${move}`);
    }
    expect(fxMoveFor("idle")).toBeNull();
    // light trails only for the skins that leave them
    expect(renderToStaticMarkup(createElement(MoveFx, { move: "jump", palette: fxPalette("neon", "#377FE6"), uid: "t", path: "M0 0Z" }))).toContain("fx-ghost");
    expect(renderToStaticMarkup(createElement(MoveFx, { move: "jump", palette: fxPalette("gold", "#377FE6"), uid: "t", path: "M0 0Z" }))).not.toContain("fx-ghost");
  });
});

describe("reduced motion and flashing", () => {
  const saved = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = saved;
  });

  it("keeps the premium look but plays nothing under prefers-reduced-motion", () => {
    (globalThis as { window?: unknown }).window = { matchMedia: (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }) };
    const big = renderToStaticMarkup(createElement(ShapeMascot, { shape: "circle", skin: "galaxy", color: "blue", size: 112 }));
    expect(big).toContain('data-fx="full"');
    expect(big).not.toContain("skin-fx-live");
    const clip = renderToStaticMarkup(createElement(SkinnedTrombi, { skin: "glitch", pose: "idle", size: 112, width: 90 }));
    expect(clip).not.toContain("skin-fx-live");
  });

  it("stops every effect and the cards' shimmer in the CSS too", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".skin-fx-live *");
    expect(block).toContain(".skin-fx-overlay { display: none; }");
    expect(block).toContain(".skin-card::after");
    expect(css).toContain("[data-fx-paused] *");
  });

  it("never flashes more than three times a second", () => {
    const keyframes = (name: string) => css.slice(css.indexOf(`@keyframes ${name} {`), css.indexOf("}\n}", css.indexOf(`@keyframes ${name} {`)));
    // the neon flicker: two soft dips (never below 0.6) per five seconds
    const flicker = keyframes("fx-flicker");
    expect(css).toMatch(/\.fx-neon-flicker \{ animation: fx-flicker 5s/);
    const dips = [...flicker.matchAll(/opacity: ([\d.]+)/g)].map((m) => Number(m[1])).filter((value) => value < 1);
    expect(dips.length).toBeLessThanOrEqual(2);
    expect(Math.min(...dips)).toBeGreaterThanOrEqual(0.6);
    // the glitch moves its ghosts (no brightness change) at most 4 steps in 2.4 s
    expect(keyframes("fx-glitch-r")).not.toContain("opacity");
    expect(css).toMatch(/fx-glitch-r 2\.4s steps/);
  });
});

describe("the holographic foil glides without a seam", () => {
  const appCss = readFileSync(join(here, "../../styles.css"), "utf8");
  const owlFx = readFileSync(join(here, "../OwlSkinFx.tsx"), "utf8");
  const rule = (source: string, selector: string) => {
    const start = source.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("}", start));
  };
  const seconds = (text: string) => Number(/(\d+(?:\.\d+)?)s\b/.exec(text)?.[1]);

  it("plays every foil (shapes, Trombi) as a slow eased ping-pong, never a linear loop that snaps back", () => {
    for (const name of ["fx-foil", "fx-foil-diag", "fx-foil-rev"]) {
      const body = rule(css, `.skin-fx-live .${name}`);
      expect(body, name).toContain("ease-in-out");
      expect(body, name).toContain("alternate");
      expect(body, name).not.toContain("linear");
      expect(seconds(body), name).toBeGreaterThanOrEqual(6);
      expect(seconds(body), name).toBeLessThanOrEqual(10);
    }
    const large = rule(css, ".skin-fx-live .fx-foil-diag-lg");
    expect(seconds(large)).toBeGreaterThanOrEqual(6);
    expect(seconds(large)).toBeLessThanOrEqual(10);
  });

  it("glides the owl's foil the same way, over 6 to 10 seconds", () => {
    const body = rule(appCss, '[data-owl-fx="live"] .owl-fx-foil');
    expect(body).toContain("ease-in-out");
    expect(body).toContain("alternate");
    expect(body).not.toContain("linear");
    const duration = Number(/className="owl-fx-foil" style=\{anim\((\d+(?:\.\d+)?)\)/.exec(owlFx)?.[1]);
    expect(duration).toBeGreaterThanOrEqual(6);
    expect(duration).toBeLessThanOrEqual(10);
  });

  it("never animates a filter (hue-rotate repaints every frame and flickers)", () => {
    expect(css).not.toMatch(/hue-rotate/);
    expect(rule(appCss, "@keyframes owl-fx-foil")).not.toContain("filter");
    for (const name of ["fx-foil", "fx-foil-diag", "fx-foil-rev", "fx-foil-diag-lg", "fx-sweep"]) {
      expect(rule(css, `@keyframes ${name}`), name).not.toMatch(/filter|background-position/);
    }
  });

  it("keeps the drawing mounted through a move, so the idle loops never restart", () => {
    const shapeSource = readFileSync(join(here, "../ShapeMascot.tsx"), "utf8");
    const trombiSource = readFileSync(join(here, "SkinnedTrombi.tsx"), "utf8");
    for (const source of [shapeSource, trombiSource]) {
      expect(source).not.toMatch(/key=\{burst && moveBody/);
      expect(source).toContain("useReplayMove(body");
    }
  });

  it("renders the same markup twice (stable ids and classes, nothing that remounts the foil)", () => {
    const a = renderToStaticMarkup(createElement(ShapeMascot, { shape: "star", skin: "holo", color: "blue", size: 112 }));
    const b = renderToStaticMarkup(createElement(ShapeMascot, { shape: "star", skin: "holo", color: "blue", size: 112 }));
    expect(a).toBe(b);
    expect(a).toContain('class="fx-foil-diag"');
    expect(a).toContain('class="fx-foil-rev"');
  });
});

describe("skin ids persist and migrate", () => {
  it("maps older skin names to the current ids (the desktop window: electron/floating-bot-window.test.mjs)", () => {
    for (const [old, current] of Object.entries(LEGACY_SHAPE_SKINS)) {
      expect(botMascotLook({ character: "shape", skins: { shape: old } }).skins?.shape).toBe(current);
    }
    for (const [old, current] of Object.entries(LEGACY_TROMBI_SKINS)) {
      expect(botMascotLook({ character: "trombi", skins: { trombi: old } }).skins?.trombi).toBe(current);
    }
  });

  it("keeps every skin saved before the premium set", () => {
    for (const skin of ["plain", "glossy", "outline", "neon", "pastel", "night"]) expect(completeMascotLook({ character: "shape", skins: { shape: skin } }).skins.shape).toBe(skin);
    for (const skin of ["classic", "gold", "neon", "retro98"]) expect(completeMascotLook({ character: "trombi", skins: { trombi: skin } }).skins.trombi).toBe(skin);
  });

  it("drops a skin it does not know, never the character", () => {
    expect(botMascotLook({ character: "shape", shape: "cloud", skins: { shape: "plasma-9000", trombi: "gold" } })).toEqual({ character: "shape", shape: "cloud", skins: { trombi: "gold" } });
    expect(completeMascotLook({ character: "trombi", skins: { trombi: "future" } })).toMatchObject({ character: "trombi", skins: { trombi: "classic" } });
  });
});

describe("the avatar popover's layout", () => {
  const render = (mascotLook: unknown) =>
    renderToStaticMarkup(createElement(MascotLookEditor, { bot: { color: "blue", mascotSkin: "none", mascotLook: botMascotLook(mascotLook) }, onPatch: () => undefined }));

  it("has no preview tile: the character cards use the full width", () => {
    const html = render({ character: "shape" });
    expect(html).toContain('data-character-row=""');
    expect(html).not.toContain("size-[64px]");
    expect(html).not.toContain("place-items-end overflow-visible");
  });

  it("names the character Shapes (Formes), never Original shapes", () => {
    expect(en["floatingBots.mascot.body"]).toBe("Shapes");
    expect(fr["floatingBots.mascot.body"]).toBe("Formes");
    expect(render({ character: "shape" })).toContain(">Shapes<");
    expect(JSON.stringify(en)).not.toMatch(/Original shapes/i);
    expect(JSON.stringify(fr)).not.toMatch(/Formes originales/i);
  });

  it("shows each skin as a card with its rarity, previewing it animated, one rarity at a time", () => {
    for (const skin of SHAPE_SKINS) {
      const html = render({ character: "shape", skins: { shape: skin } });
      expect(html).toMatch(new RegExp(`data-tier="${SHAPE_SKIN_TIER[skin]}"[^>]*data-shape-skin-option="${skin}"`));
      const cards = html.match(/data-shape-skin-option="/g) ?? [];
      expect(cards.length).toBe(SHAPE_SKINS.filter((other) => SHAPE_SKIN_TIER[other] === SHAPE_SKIN_TIER[skin]).length);
      // the open tab's cards play their skins (the Shape grid's thumbnails never do)
      expect((html.match(/skin-fx-live/g) ?? []).length).toBe(cards.length);
    }
    expect(render({ character: "shape", skins: { shape: "galaxy" } })).toContain(">Legendary<");
    for (const skin of TROMBI_SKINS) expect(render({ character: "trombi", skins: { trombi: skin } })).toContain(`data-trombi-skin-option="${skin}"`);
    for (const key of Object.values(SKIN_TIER_LABEL)) {
      expect(en).toHaveProperty([key]);
      expect(fr).toHaveProperty([key]);
    }
  });
});
