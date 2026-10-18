// The miniatures of Settings > Appearance > Background effects. One hidden
// WebGL2 canvas for the whole gallery (a context per tile would run out of
// contexts): each tile asks for a frame, the shared canvas draws it and the
// tile copies it onto its own 2D canvas in the same task. A tile shows a still
// frame (a click mid-wave, the pointer resting) and animates only while it is
// hovered, at 30 frames a second, never with reduced motion.

import { MAX_CLICKS } from "./background-shaders";
import { createShaderRenderer, isWebGL2, QUIET_CELL, REST_TIME, shaderLook, type ShaderFrame, type ShaderGrid, type ShaderRenderer } from "./background-engine";
import { resolvePalette, type BackgroundEffectId, type PaletteId } from "./background-effects";
import { createWebGLRenderer, energyColors, resolveRgb, waveAt, MAX_WAVES, type EnergyFrame, type EnergyRenderer } from "./glyph-energy";
import { CELL, type GlyphColors } from "./glyph-ripple";

/** The shared canvas, device px; tiles scale it to their width. */
export const PREVIEW_WIDTH = 264;
export const PREVIEW_HEIGHT = 150;
/** A miniature shows a pane this many times its size (features at half size). */
const PREVIEW_ZOOM = 2;
/** A miniature is small: it shows the effect brighter than the pane does. */
const PREVIEW_GAIN = 1.7;
/** Glyph cells of the miniature, device px. */
const PREVIEW_GLYPH_DPR = 0.62;

export interface PreviewScene {
  /** the effect's clock, s */
  time: number;
  /** pointer, 0..1 of the tile, and its presence */
  pointer: { x: number; y: number; presence: number };
  /** clicks, 0..1 of the tile, age in s */
  clicks: ReadonlyArray<{ x: number; y: number; age: number; seed: number }>;
}

/** The still frame of a tile: the pointer resting, one click mid-wave. */
export function stillScene(index: number): PreviewScene {
  return { time: REST_TIME + index * 1.7, pointer: { x: 0.66, y: 0.42, presence: 0.75 }, clicks: [{ x: 0.36, y: 0.56, age: 0.55, seed: 3.1 + index }] };
}

/** The hovered tile's scene at `t` seconds: the pointer on a slow loop, a
 * click every 1.5 s somewhere new. */
export function animatedScene(t: number): PreviewScene {
  const clicks: Array<{ x: number; y: number; age: number; seed: number }> = [];
  const period = 1.5;
  const last = Math.floor(t / period);
  for (let k = last; k > last - 2 && k >= 0; k -= 1) {
    const age = t - k * period;
    const h = Math.sin(k * 12.9898) * 43758.5453;
    const r = h - Math.floor(h);
    clicks.push({ x: 0.2 + 0.6 * r, y: 0.25 + 0.5 * ((r * 7.31) % 1), age, seed: k * 0.73 });
  }
  return {
    time: REST_TIME + t,
    pointer: { x: 0.5 + 0.34 * Math.sin(t * 0.9), y: 0.5 + 0.3 * Math.sin(t * 1.3 + 1), presence: 1 },
    clicks,
  };
}

interface Shared {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  shaders: Map<BackgroundEffectId, ShaderRenderer | null>;
  glyphs: EnergyRenderer | null | undefined;
}

let shared: Shared | null | undefined;

function getShared(): Shared | null {
  if (shared !== undefined) return shared;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
    shared = isWebGL2(gl) ? { canvas, gl, shaders: new Map(), glyphs: undefined } : null;
    // a lost context (too many open, a GPU reset): start over on the next draw
    canvas.addEventListener("webglcontextlost", () => {
      shared = undefined;
    });
  } catch {
    shared = null;
  }
  return shared;
}

/** Whether this computer can draw the shader effects (WebGL2). */
export function webgl2Available(): boolean {
  return getShared() !== null;
}

const GRID: ShaderGrid = {
  width: PREVIEW_WIDTH,
  height: PREVIEW_HEIGHT,
  scale: 1 / PREVIEW_ZOOM,
  cssWidth: PREVIEW_WIDTH * PREVIEW_ZOOM,
  cssHeight: PREVIEW_HEIGHT * PREVIEW_ZOOM,
  cols: Math.ceil((PREVIEW_WIDTH * PREVIEW_ZOOM) / QUIET_CELL),
  rows: Math.ceil((PREVIEW_HEIGHT * PREVIEW_ZOOM) / QUIET_CELL),
};

const shaderFrame: ShaderFrame = {
  time: REST_TIME,
  pointer: new Float32Array(4),
  velocity: new Float32Array(2),
  drift: new Float32Array(2),
  count: 0,
  clicks: new Float32Array(MAX_CLICKS * 4),
  live: 1,
};

const glyphFrame: EnergyFrame = {
  time: 0,
  count: 0,
  waves: new Float32Array(MAX_WAVES * 4),
  shapes: new Float32Array(MAX_WAVES * 4),
  hover: new Float32Array(4),
  decay: 0,
  live: true,
};

function shaderFor(s: Shared, effect: BackgroundEffectId): ShaderRenderer | null {
  if (!s.shaders.has(effect)) {
    const renderer = createShaderRenderer(s.gl, effect);
    renderer?.resize(GRID);
    s.shaders.set(effect, renderer);
  }
  return s.shaders.get(effect) ?? null;
}

function drawGlyphs(s: Shared, scene: PreviewScene, colors: GlyphColors, tint: string): boolean {
  if (s.glyphs === undefined) {
    s.glyphs = createWebGLRenderer(s.gl);
    const cellPx = Math.max(4, Math.round(CELL * PREVIEW_GLYPH_DPR));
    s.glyphs?.resize({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, dpr: PREVIEW_GLYPH_DPR, cellPx, cols: Math.ceil(PREVIEW_WIDTH / cellPx), rows: Math.ceil(PREVIEW_HEIGHT / cellPx) });
  }
  const renderer = s.glyphs;
  if (!renderer) return false;
  renderer.setColors(energyColors({ ...colors, tint, gain: PREVIEW_GAIN }));
  const cssW = PREVIEW_WIDTH / PREVIEW_GLYPH_DPR;
  const cssH = PREVIEW_HEIGHT / PREVIEW_GLYPH_DPR;
  const f = glyphFrame;
  let count = 0;
  for (const click of scene.clicks) {
    const { radius, width, amp } = waveAt(click.age * 1000);
    if (amp <= 0 || count >= MAX_WAVES) continue;
    const k = count * 4;
    f.waves[k] = click.x * cssW;
    f.waves[k + 1] = click.y * cssH;
    f.waves[k + 2] = click.age;
    f.waves[k + 3] = click.seed;
    // the miniature's waves travel a third as far
    f.shapes[k] = radius * 0.45;
    f.shapes[k + 1] = width * 0.6;
    f.shapes[k + 2] = amp;
    f.shapes[k + 3] = 0;
    count += 1;
  }
  f.count = count;
  f.hover[0] = scene.pointer.x * cssW;
  f.hover[1] = scene.pointer.y * cssH;
  f.hover[2] = scene.pointer.presence;
  f.hover[3] = scene.time % 1000;
  f.time = scene.time % 1000;
  // no afterglow: each tile draws a fresh frame of its own
  f.decay = 0;
  f.live = true;
  renderer.draw(f);
  return true;
}

/** Draws `effect` in `palette` for `scene` onto the tile's 2D canvas. False
 * when the effect cannot be drawn here (no WebGL2, a shader that fails): the
 * tile then shows its colour swatch. `colors` are the skin's (readGlyphColors
 * on the tile's canvas). */
export function drawPreview(target: HTMLCanvasElement, effect: BackgroundEffectId, palette: PaletteId, colors: GlyphColors, scene: PreviewScene): boolean {
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  ctx.clearRect(0, 0, target.width, target.height);
  if (effect === "none") return true;
  const s = getShared();
  if (!s || s.gl.isContextLost()) return false;
  s.gl.viewport(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  s.gl.clearColor(0, 0, 0, 0);
  s.gl.bindFramebuffer(s.gl.FRAMEBUFFER, null);
  s.gl.clear(s.gl.COLOR_BUFFER_BIT);
  let drawn = false;
  if (effect === "glyphs") {
    const theme = { ink: resolveRgb(colors.ink), tint: resolveRgb(colors.tint) };
    const a = resolvePalette(palette, colors.scheme, theme).a;
    drawn = drawGlyphs(s, scene, colors, `rgb(${Math.round(a.r * 255)}, ${Math.round(a.g * 255)}, ${Math.round(a.b * 255)})`);
  } else {
    const renderer = shaderFor(s, effect);
    if (renderer) {
      renderer.setLook(shaderLook(colors, palette, PREVIEW_GAIN));
      const f = shaderFrame;
      f.time = scene.time;
      f.pointer[0] = scene.pointer.x * GRID.cssWidth;
      f.pointer[1] = scene.pointer.y * GRID.cssHeight;
      f.pointer[2] = scene.pointer.presence;
      f.pointer[3] = 0.4;
      f.drift[0] = (scene.pointer.x * 2 - 1) * 0.5;
      f.drift[1] = (scene.pointer.y * 2 - 1) * 0.5;
      let count = 0;
      for (const click of scene.clicks) {
        if (count >= MAX_CLICKS) break;
        const k = count * 4;
        f.clicks[k] = click.x * GRID.cssWidth;
        f.clicks[k + 1] = click.y * GRID.cssHeight;
        f.clicks[k + 2] = click.age;
        f.clicks[k + 3] = click.seed;
        count += 1;
      }
      f.count = count;
      f.live = 1;
      renderer.draw(f);
      drawn = true;
    }
  }
  if (!drawn) return false;
  ctx.drawImage(s.canvas, 0, 0, target.width, target.height);
  return true;
}
