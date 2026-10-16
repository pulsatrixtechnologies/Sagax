// The glyph field behind the conversation (Settings > Appearance > "Glyph
// ripple on click"). At rest: faint monospace letters and digits in islands,
// drawn ONCE. A click in the conversation sends a ring out from the pointer:
// the characters it crosses scramble and light up in the skin's tint, then
// the ring fades and the field is back to rest.
//
// Cost rules (JC, 2026-10-16: at least as fast as Grok Bot):
// - one canvas, pointer-events none, sized to devicePixelRatio;
// - glyphs pre-rendered once into an atlas (one row in ink, one in the tint):
//   a frame is drawImage calls only, no fillText, no text shaping;
// - a frame touches only the cells inside the live rings plus the cells it
//   lit on the frame before (to put them back); nothing else is repainted;
// - requestAnimationFrame runs only while a ring is alive, at most
//   MAX_RIPPLES rings at once (a fourth replaces the oldest);
// - no React anywhere in the loop.
// The DOM wiring (resize, theme, visibility, the click listener) is
// mountGlyphField at the bottom; GlyphRippleLayer.tsx only mounts it.

import { prefersReducedMotion } from "./motion";
import { readColorScheme } from "./color-scheme";

export const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** Rings alive at once. */
export const MAX_RIPPLES = 3;
/** A ring's whole life, from the click to the field at rest. */
export const RIPPLE_MS = 1100;
/** How far a ring travels (CSS px) before it is gone. */
export const RIPPLE_REACH = 560;
/** One character cell and its font, in CSS px. */
export const CELL = 14;
export const FONT = 11;
const FONT_STACK = '"SF Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/** Peak opacities. The rest field stays under the faintest ink the app uses
 * (ink-tertiary is ~56%), far below anything that could compete with text. */
export const LEVELS = {
  dark: { rest: 0.07, ink: 0.16, tint: 0.55 },
  light: { rest: 0.065, ink: 0.13, tint: 0.5 },
} as const;

export interface GlyphColors {
  ink: string;
  tint: string;
  scheme: "light" | "dark";
}

/** The subset of the 2D context the field uses (a fake in the tests). */
export interface GlyphContext {
  globalAlpha: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

/** Builds the atlas: GLYPHS.length cells wide, two rows (ink, tint). */
export type AtlasFactory = (cell: number, fontPx: number, colors: GlyphColors) => CanvasImageSource;

// ------------------------------------------------------------- pure math ---

/** A 32-bit integer hash of a cell and a seed (stable across resizes, so the
 * islands stay where they were when the window changes size). */
export function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const unit = (h: number) => h / 4294967296;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a lattice of `scale` cells, 0..1. */
export function islandNoise(col: number, row: number, scale = 7): number {
  const fx = col / scale;
  const fy = row / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = unit(hash3(x0, y0, 11));
  const b = unit(hash3(x0 + 1, y0, 11));
  const c = unit(hash3(x0, y0 + 1, 11));
  const d = unit(hash3(x0 + 1, y0 + 1, 11));
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** A cell at rest: its glyph and its opacity relative to the rest level
 * (0 = blank). Islands of characters, blank water between them. */
export function restCell(col: number, row: number): { glyph: number; alpha: number } {
  const n = islandNoise(col, row);
  const island = n <= 0.42 ? 0 : n >= 0.72 ? 1 : smooth((n - 0.42) / 0.3);
  const h = hash3(col, row, 3);
  const jitter = unit(h);
  const alpha = island === 0 || jitter < 0.22 ? 0 : island * (0.35 + 0.65 * jitter);
  return { glyph: hash3(col, row, 5) % GLYPHS.length, alpha };
}

/** Ring geometry at `elapsed` ms: radius, half band width (CSS px) and the
 * ring's overall strength, 0 once the ring is over. */
export function ringAt(elapsed: number): { radius: number; band: number; strength: number } {
  if (elapsed < 0 || elapsed >= RIPPLE_MS) return { radius: 0, band: 0, strength: 0 };
  const t = elapsed / RIPPLE_MS;
  const radius = RIPPLE_REACH * (1 - (1 - t) ** 3);
  const band = 26 + 34 * t;
  const strength = (1 - t) ** 1.6;
  return { radius, band, strength };
}

/** How lit a cell at `distance` from the click is, 0..1. */
export function ringIntensity(distance: number, elapsed: number): number {
  const { radius, band, strength } = ringAt(elapsed);
  if (strength <= 0) return 0;
  const off = Math.abs(distance - radius) / band;
  if (off >= 1) return 0;
  const bump = 1 - off;
  return strength * bump * bump;
}

const NO_RIPPLE = [
  "input",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='listbox']",
  "[role='option']",
  "[role='dialog']",
  "[data-no-glyph-ripple]",
].join(",");

export interface RippleClick {
  button: number;
  isPrimary?: boolean;
  pointerType?: string;
  target: EventTarget | null;
}

/** Whether a pointerdown in the conversation pane starts a ring: the main
 * button of a mouse or pen, not touch (desktop only), never in a field, an
 * editable message, a menu or a dialog, never with reduced motion (the system
 * setting or the app's own switch) and never in a hidden window. The listener
 * sits on the transcript's scroller, so the composer and the menus (siblings
 * or portals) never reach it in the first place; this is the second fence. */
export function startsRipple(event: RippleClick, env: { reducedMotion: boolean; hidden: boolean }): boolean {
  if (env.reducedMotion || env.hidden) return false;
  if (event.button !== 0 || event.isPrimary === false) return false;
  if (event.pointerType === "touch") return false;
  const target = event.target as Element | null;
  if (target && typeof target.closest === "function" && target.closest(NO_RIPPLE)) return false;
  return true;
}

// ---------------------------------------------------------------- engine ---

interface Ripple {
  clientX: number;
  clientY: number;
  /** device px in the canvas, resolved on the ring's first frame */
  x: number;
  y: number;
  placed: boolean;
  start: number;
  seed: number;
}

export interface GlyphFieldOptions {
  context: GlyphContext;
  atlas: AtlasFactory;
  /** The canvas's box in client coordinates (read once per frame at most,
   * inside the frame, never in the input handler). */
  rect: () => { left: number; top: number };
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export class GlyphField {
  private readonly ctx: GlyphContext;
  private readonly makeAtlas: AtlasFactory;
  private readonly rect: () => { left: number; top: number };
  private readonly now: () => number;
  private readonly requestFrame: (callback: (time: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  private atlas: CanvasImageSource | null = null;
  private colors: GlyphColors | null = null;
  private dpr = 1;
  private cell = CELL;
  private cols = 0;
  private rows = 0;
  private restGlyph = new Uint8Array(0);
  private restAlpha = new Float32Array(0);
  private lit = new Float32Array(0);
  private litGlyph = new Uint8Array(0);
  private stamp = new Uint32Array(0);
  private previous = new Int32Array(0);
  private previousCount = 0;
  private current = new Int32Array(0);
  private frameNo = 0;
  private ripples: Ripple[] = [];
  private handle: number | null = null;
  private seed = 1;

  /** Frames drawn since mount (the tests and the bench read it). */
  frames = 0;

  constructor(options: GlyphFieldOptions) {
    this.ctx = options.context;
    this.makeAtlas = options.atlas;
    this.rect = options.rect;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  }

  get animating(): boolean {
    return this.handle !== null;
  }

  get rippleCount(): number {
    return this.ripples.length;
  }

  get size(): { cols: number; rows: number; cell: number } {
    return { cols: this.cols, rows: this.rows, cell: this.cell };
  }

  /** New canvas size (device px) or density: rebuilds the grid and the atlas,
   * drops any ring and draws the rest field once. */
  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr > 0 ? dpr : 1;
    this.cell = Math.max(4, Math.round(CELL * this.dpr));
    this.cols = Math.max(0, Math.ceil(width / this.cell));
    this.rows = Math.max(0, Math.ceil(height / this.cell));
    const n = this.cols * this.rows;
    this.restGlyph = new Uint8Array(n);
    this.restAlpha = new Float32Array(n);
    this.lit = new Float32Array(n);
    this.litGlyph = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.previous = new Int32Array(n);
    this.current = new Int32Array(n);
    this.previousCount = 0;
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const cell = restCell(col, row);
        const i = row * this.cols + col;
        this.restGlyph[i] = cell.glyph;
        this.restAlpha[i] = cell.alpha;
      }
    }
    this.atlas = this.colors ? this.makeAtlas(this.cell, FONT * this.dpr, this.colors) : null;
    this.stop();
    this.ripples = [];
    this.drawRest(width, height);
  }

  /** New skin colours: rebuilds the atlas and redraws the rest field. Returns
   * false when nothing changed (no repaint). */
  setColors(colors: GlyphColors): boolean {
    const old = this.colors;
    if (old && old.ink === colors.ink && old.tint === colors.tint && old.scheme === colors.scheme) return false;
    this.colors = colors;
    if (this.cols > 0) {
      this.atlas = this.makeAtlas(this.cell, FONT * this.dpr, colors);
      this.stop();
      this.ripples = [];
      this.drawRest(this.cols * this.cell, this.rows * this.cell);
    }
    return true;
  }

  /** A click at client coordinates. False when the field cannot draw yet. */
  ripple(clientX: number, clientY: number): boolean {
    if (!this.atlas || this.cols === 0) return false;
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.seed = (this.seed + 1) | 0;
    this.ripples.push({ clientX, clientY, x: 0, y: 0, placed: false, start: this.now(), seed: this.seed * 7919 });
    if (this.handle === null) this.handle = this.requestFrame(this.tick);
    return true;
  }

  /** Drops every ring and puts the field back at rest (hidden window). */
  settle(): void {
    if (this.ripples.length === 0 && this.previousCount === 0) {
      this.stop();
      return;
    }
    this.stop();
    this.ripples = [];
    for (let k = 0; k < this.previousCount; k += 1) this.drawCellRest(this.previous[k]);
    this.previousCount = 0;
  }

  destroy(): void {
    this.stop();
    this.ripples = [];
  }

  private stop(): void {
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
  }

  private drawRest(width: number, height: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    if (!this.atlas || !this.colors) return;
    const rest = LEVELS[this.colors.scheme].rest;
    const c = this.cell;
    for (let i = 0; i < this.restAlpha.length; i += 1) {
      const alpha = this.restAlpha[i];
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha * rest;
      const col = i % this.cols;
      const row = (i - col) / this.cols;
      ctx.drawImage(this.atlas, this.restGlyph[i] * c, 0, c, c, col * c, row * c, c, c);
    }
    ctx.globalAlpha = 1;
  }

  private drawCellRest(i: number): void {
    const c = this.cell;
    const col = i % this.cols;
    const row = (i - col) / this.cols;
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.clearRect(col * c, row * c, c, c);
    const alpha = this.restAlpha[i];
    if (alpha <= 0 || !this.atlas || !this.colors) return;
    ctx.globalAlpha = alpha * LEVELS[this.colors.scheme].rest;
    ctx.drawImage(this.atlas, this.restGlyph[i] * c, 0, c, c, col * c, row * c, c, c);
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (!this.atlas || !this.colors) return;
    const now = this.now();
    this.frames += 1;
    this.frameNo = (this.frameNo + 1) >>> 0 || 1;
    const frame = this.frameNo;
    const c = this.cell;
    const cols = this.cols;
    const rows = this.rows;
    let count = 0;

    this.ripples = this.ripples.filter((ripple) => now - ripple.start < RIPPLE_MS);
    let box: { left: number; top: number } | null = null;
    for (const ripple of this.ripples) {
      if (!ripple.placed) {
        box ??= this.rect();
        ripple.x = (ripple.clientX - box.left) * this.dpr;
        ripple.y = (ripple.clientY - box.top) * this.dpr;
        ripple.placed = true;
      }
      const elapsed = now - ripple.start;
      const { radius, band, strength } = ringAt(elapsed);
      if (strength <= 0) continue;
      const r = radius * this.dpr;
      const w = band * this.dpr;
      const outer = r + w;
      const inner = Math.max(0, r - w);
      const tick = Math.floor(elapsed / 60);
      const rowMin = Math.max(0, Math.floor((ripple.y - outer) / c));
      const rowMax = Math.min(rows - 1, Math.floor((ripple.y + outer) / c));
      for (let row = rowMin; row <= rowMax; row += 1) {
        const dy = (row + 0.5) * c - ripple.y;
        const ady = Math.abs(dy);
        if (ady > outer) continue;
        const wo = Math.sqrt(outer * outer - dy * dy);
        const wi = inner > ady ? Math.sqrt(inner * inner - dy * dy) : 0;
        // the two arcs of the ring on this row (one span when it is a cap)
        for (let side = 0; side < (wi > 0 ? 2 : 1); side += 1) {
          const from = wi > 0 ? (side === 0 ? ripple.x - wo : ripple.x + wi) : ripple.x - wo;
          const to = wi > 0 ? (side === 0 ? ripple.x - wi : ripple.x + wo) : ripple.x + wo;
          const colMin = Math.max(0, Math.floor(from / c - 0.5));
          const colMax = Math.min(cols - 1, Math.ceil(to / c - 0.5));
          for (let col = colMin; col <= colMax; col += 1) {
            const dx = (col + 0.5) * c - ripple.x;
            const off = Math.abs(Math.sqrt(dx * dx + dy * dy) - r) / w;
            if (off >= 1) continue;
            const v = strength * (1 - off) * (1 - off);
            if (v < 0.02) continue;
            const i = row * cols + col;
            if (this.stamp[i] !== frame) {
              this.stamp[i] = frame;
              this.lit[i] = v;
              this.litGlyph[i] = hash3(col, row, ripple.seed + tick) % GLYPHS.length;
              this.current[count] = i;
              count += 1;
            } else if (v > this.lit[i]) {
              this.lit[i] = v;
            }
          }
        }
      }
    }

    // cells lit last frame and dark now go back to rest
    for (let k = 0; k < this.previousCount; k += 1) {
      const i = this.previous[k];
      if (this.stamp[i] !== frame) this.drawCellRest(i);
    }

    const ctx = this.ctx;
    const level = LEVELS[this.colors.scheme];
    const atlas = this.atlas;
    for (let k = 0; k < count; k += 1) {
      const i = this.current[k];
      const col = i % cols;
      const row = (i - col) / cols;
      const x = col * c;
      const y = row * c;
      const v = this.lit[i];
      const g = this.litGlyph[i] * c;
      ctx.globalAlpha = 1;
      ctx.clearRect(x, y, c, c);
      // the island under the ring scrambles in ink; the ring itself (water
      // included, so it reads as one ring) brightens in the tint
      const inkAlpha = this.restAlpha[i] * level.rest * (1 - v) + v * level.ink * (0.4 + 0.6 * this.restAlpha[i]);
      if (inkAlpha > 0.004) {
        ctx.globalAlpha = inkAlpha;
        ctx.drawImage(atlas, g, 0, c, c, x, y, c, c);
      }
      ctx.globalAlpha = v * level.tint;
      ctx.drawImage(atlas, g, c, c, c, x, y, c, c);
    }
    ctx.globalAlpha = 1;

    const swap = this.previous;
    this.previous = this.current;
    this.current = swap;
    this.previousCount = count;

    if (this.ripples.length > 0 || count > 0) this.handle = this.requestFrame(this.tick);
  };
}

// ------------------------------------------------------------ DOM wiring ---

/** The atlas, drawn once per size and skin. */
export function canvasAtlas(cell: number, fontPx: number, colors: GlyphColors): CanvasImageSource {
  const width = cell * GLYPHS.length;
  const height = cell * 2;
  const atlas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas === "function"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = atlas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return atlas;
  ctx.font = `500 ${fontPx}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [colors.ink, colors.tint].forEach((color, row) => {
    ctx.fillStyle = color;
    for (let k = 0; k < GLYPHS.length; k += 1) ctx.fillText(GLYPHS[k], k * cell + cell / 2, row * cell + cell / 2 + 0.5);
  });
  return atlas;
}

/** The skin's ink and tint where the canvas sits. The canvas carries
 * `color: var(--color-ink)` and `border-color: var(--glyph-ripple-tint)`
 * (no border is drawn): the computed values are resolved colours, whatever
 * the skin wrote (a hex, color-mix, a var). */
export function readGlyphColors(canvas: HTMLElement): GlyphColors {
  const style = getComputedStyle(canvas);
  return { ink: style.color || "#888", tint: style.borderTopColor || style.color || "#888", scheme: readColorScheme() };
}

/** Mounts the field on `canvas` and listens for clicks on `pane`. Returns the
 * cleanup. Nothing runs between rings: no timer, no frame, no listener work
 * beyond one cheap test per pointerdown. */
export function mountGlyphField(canvas: HTMLCanvasElement, pane: HTMLElement): { field: GlyphField | null; unmount: () => void } {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return { field: null, unmount: () => {} };
  const field = new GlyphField({ context, atlas: canvasAtlas, rect: () => canvas.getBoundingClientRect() });
  let sizeFrame: number | null = null;
  let lastWidth = -1;
  let lastHeight = -1;
  let lastDpr = -1;

  const applySize = () => {
    sizeFrame = null;
    if (document.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
    lastWidth = width;
    lastHeight = height;
    lastDpr = dpr;
    canvas.width = width;
    canvas.height = height;
    field.setColors(readGlyphColors(canvas));
    field.resize(width, height, dpr);
  };
  const queueSize = () => {
    if (sizeFrame === null) sizeFrame = requestAnimationFrame(applySize);
  };
  const recolor = () => {
    if (lastWidth < 0) return;
    field.setColors(readGlyphColors(canvas));
  };

  applySize();
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(queueSize) : null;
  resizeObserver?.observe(canvas);
  // another screen, another density: the canvas keeps its CSS size
  let densityQuery: MediaQueryList | null = null;
  const watchDensity = () => {
    densityQuery?.removeEventListener("change", onDensity);
    densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    densityQuery?.addEventListener("change", onDensity);
  };
  const onDensity = () => {
    watchDensity();
    queueSize();
  };
  watchDensity();
  // skin or scheme change: the picker stamps data-skin on the root
  const themeObserver = typeof MutationObserver === "function" ? new MutationObserver(recolor) : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "class", "style", "data-theme"] });
  const schemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  schemeQuery?.addEventListener("change", recolor);

  const onVisibility = () => {
    if (document.hidden) field.settle();
    else queueSize();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPointerDown = (event: PointerEvent) => {
    if (!startsRipple(event, { reducedMotion: prefersReducedMotion(), hidden: document.hidden })) return;
    field.ripple(event.clientX, event.clientY);
  };
  pane.addEventListener("pointerdown", onPointerDown, { passive: true });

  return {
    field,
    unmount: () => {
      pane.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
      schemeQuery?.removeEventListener("change", recolor);
      themeObserver?.disconnect();
      densityQuery?.removeEventListener("change", onDensity);
      resizeObserver?.disconnect();
      if (sizeFrame !== null) cancelAnimationFrame(sizeFrame);
      field.destroy();
    },
  };
}
