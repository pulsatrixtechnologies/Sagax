// The engine of the shader background effects (Settings > Appearance >
// Background effects; the glyph field of #716 keeps its own engine,
// src/lib/glyph-energy.ts). One canvas behind the transcript, one WebGL2
// program per effect (src/lib/background-shaders.ts), a full-screen pass.
//
// Cost rules (the glyph field's, JC 2026-10-16, plus a budget for a pass that
// runs on every pixel):
// - the canvas is drawn at CSS resolution at most (never at the retina
//   density) and under MAX_PIXELS, the browser scales it up: the effects
//   are soft, the text above stays sharp;
// - requestAnimationFrame runs only while the person interacts: a click is
//   alive, or the pointer moved in the last LINGER_MS. Then the effect's
//   clock eases to a stop and the loop ends; the last frame stays on screen.
//   At rest nothing runs, nothing is drawn;
// - at most 60 frames a second, even on a 120 Hz display;
// - a hidden window, a window that loses focus, reduced motion: the field
//   settles at once (mountGlyphField's wiring, shared with the glyph field);
// - no React in the loop, no allocation per frame.
// Readability: while the effect runs, the text boxes on screen become a
// quiet map (the glyph field's, quietMap and visibleTextRects) and the
// effect keeps 40% of its brightness under text.

import { CLICK_BOOST, CLICK_LIFE, MAX_CLICKS, VERTEX_SHADER, fragmentShader } from "./background-shaders";
import { isPaletteId, resolvePalette, type BackgroundEffectId, type PaletteColors, type PaletteId, type RGB } from "./background-effects";
import { QUIET_REFRESH_MS, quietMap, releaseContextWhenGone, resolveRgb, visibleTextRects } from "./glyph-energy";
import { mountGlyphField, sameGlyphColors, type GlyphColors, type GlyphEngine } from "./glyph-ripple";

/** The most pixels a frame draws (about 1600 x 900). */
export const MAX_PIXELS = 1_440_000;
/** The pointer keeps the effect running this long after its last move. */
export const LINGER_MS = 1400;
/** The shortest time between two frames (60 fps). */
export const FRAME_MS = 1000 / 61;
/** On battery: 30 fps and half the pixels. */
export const BATTERY_FRAME_MS = 1000 / 31;
export const BATTERY_PIXEL_SHARE = 0.5;

// On battery (the Battery Status API, where the browser has it; Electron
// does), the effects draw half the pixels at 30 fps. Read once, then kept up
// to date by the battery's own event.
let onBattery = false;
let batteryWatched = false;
const batteryListeners = new Set<() => void>();
/** Called when the machine goes on or off battery (the pixel budget changes). */
export function onBatteryChange(listener: () => void): () => void {
  batteryListeners.add(listener);
  return () => batteryListeners.delete(listener);
}
export function watchBattery(): void {
  if (batteryWatched || typeof navigator === "undefined") return;
  batteryWatched = true;
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; addEventListener(type: string, listener: () => void): void }> };
  nav.getBattery?.().then((battery) => {
    const update = () => {
      const next = !battery.charging;
      if (next === onBattery) return;
      onBattery = next;
      for (const listener of batteryListeners) listener();
    };
    update();
    battery.addEventListener("chargingchange", update);
  }).catch(() => {});
}
export function batterySaver(): boolean {
  return onBattery;
}
/** Tests only. */
export function setBatterySaverForTests(value: boolean): void {
  onBattery = value;
}
/** The readability map's cell, CSS px (the glyph field's). */
export const QUIET_CELL = 14;
/** The clock's rest value: the frozen frame before any interaction. */
export const REST_TIME = 23.7;

export const MAX_ALPHA = { dark: 0.7, light: 0.55 } as const;

export interface ShaderGrid {
  /** drawing buffer, px */
  width: number;
  height: number;
  /** drawing px per CSS px */
  scale: number;
  cssWidth: number;
  cssHeight: number;
  /** the readability map, cells of QUIET_CELL */
  cols: number;
  rows: number;
}

export interface ShaderLook {
  colors: PaletteColors;
  scheme: "light" | "dark";
  gain: number;
}

export interface ShaderFrame {
  time: number;
  /** x, y (CSS px), presence 0..1, speed 0..1 */
  pointer: Float32Array;
  /** smoothed velocity, CSS px per ms */
  velocity: Float32Array;
  /** persistent pointer offset from the centre, -1..1 */
  drift: Float32Array;
  count: number;
  /** MAX_CLICKS * 4: x, y (CSS px), age s, seed */
  clicks: Float32Array;
  /** 0 at rest, 1 while the person interacts (wakes the effect up) */
  live: number;
}

/** What draws (WebGL in the app, a fake in the tests). */
export interface ShaderRenderer {
  resize(grid: ShaderGrid): void;
  setLook(look: ShaderLook): void;
  setQuiet(map: Uint8Array): void;
  draw(frame: ShaderFrame): void;
  destroy(): void;
}

/** The drawing size of a pane: CSS px at most, under MAX_PIXELS. */
export function shaderGrid(cssWidth: number, cssHeight: number, maxPixels = MAX_PIXELS): ShaderGrid {
  const w = Math.max(0, cssWidth);
  const h = Math.max(0, cssHeight);
  const area = w * h;
  const scale = area > 0 ? Math.min(1, Math.sqrt(maxPixels / area)) : 1;
  return {
    width: Math.max(0, Math.round(w * scale)),
    height: Math.max(0, Math.round(h * scale)),
    scale,
    cssWidth: w,
    cssHeight: h,
    cols: Math.max(1, Math.ceil(w / QUIET_CELL)),
    rows: Math.max(1, Math.ceil(h / QUIET_CELL)),
  };
}

interface Click {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  placed: boolean;
  start: number;
  seed: number;
}

export interface ShaderFieldOptions {
  renderer: ShaderRenderer;
  rect: () => { left: number; top: number };
  /** How much a live click speeds the clock (CLICK_BOOST). */
  boost?: number;
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  quietRects?: () => ArrayLike<{ left: number; top: number; right: number; bottom: number }>;
}

const clickAmp = (age: number) => {
  if (age < 0 || age >= CLICK_LIFE) return 0;
  return Math.min(1, age / 0.05) * Math.exp(-age * 1.15);
};

/** The clicks, the pointer and the frame loop of a shader effect, outside
 * any GPU code. */
export class ShaderField {
  private readonly renderer: ShaderRenderer;
  private readonly rect: () => { left: number; top: number };
  private readonly boost: number;
  private readonly now: () => number;
  private readonly requestFrame: (callback: (time: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly quietRects: ShaderFieldOptions["quietRects"];
  private grid: ShaderGrid | null = null;
  private ready = false;
  private clicks: Click[] = [];
  private handle: number | null = null;
  private seed = 1;
  private lastTick = 0;
  private lastDraw = -Infinity;
  private lastMove = -Infinity;
  private pointerClient: { x: number; y: number } | null = null;
  private prevClient: { x: number; y: number; at: number } | null = null;
  private speed = 0;
  private quiet = new Uint8Array(0);
  private quietAt = -Infinity;
  private readonly frame: ShaderFrame = {
    time: REST_TIME,
    pointer: new Float32Array(4),
    velocity: new Float32Array(2),
    drift: new Float32Array(2),
    count: 0,
    clicks: new Float32Array(MAX_CLICKS * 4),
    live: 0,
  };

  /** Frames drawn since mount (the tests and the bench read it). */
  frames = 0;

  constructor(options: ShaderFieldOptions) {
    this.renderer = options.renderer;
    this.rect = options.rect;
    this.boost = options.boost ?? 0;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.quietRects = options.quietRects;
  }

  get animating(): boolean {
    return this.handle !== null;
  }

  get clickCount(): number {
    return this.clicks.length;
  }

  get time(): number {
    return this.frame.time;
  }

  get size(): ShaderGrid | null {
    return this.grid;
  }

  /** A new pane size (CSS px): a new drawing size, clicks dropped, one frame
   * drawn at the current clock. */
  resize(cssWidth: number, cssHeight: number): ShaderGrid {
    this.grid = shaderGrid(cssWidth, cssHeight, onBattery ? MAX_PIXELS * BATTERY_PIXEL_SHARE : MAX_PIXELS);
    this.renderer.resize(this.grid);
    this.quiet = new Uint8Array(this.grid.cols * this.grid.rows);
    this.quietAt = -Infinity;
    this.ready = this.grid.width > 0 && this.grid.height > 0;
    this.reset();
    return this.grid;
  }

  setLook(look: ShaderLook): void {
    this.renderer.setLook(look);
    if (this.ready && !this.animating) this.drawStill();
  }

  /** A click at client coordinates. False when the field cannot draw yet. */
  click(clientX: number, clientY: number): boolean {
    if (!this.ready) return false;
    if (this.clicks.length >= MAX_CLICKS) this.clicks.shift();
    this.seed = (this.seed + 1) | 0;
    this.clicks.push({ clientX, clientY, x: 0, y: 0, placed: false, start: this.now(), seed: ((this.seed * 7919) % 997) / 7.3 });
    this.wake();
    return true;
  }

  hover(clientX: number, clientY: number): void {
    if (!this.ready) return;
    this.pointerClient = { x: clientX, y: clientY };
    this.lastMove = this.now();
    this.wake();
  }

  leave(): void {
    this.lastMove = -Infinity;
    this.prevClient = null;
  }

  /** Drops the clicks and the pointer and stops: the field at rest, at the
   * clock it reached (a hidden window, focus lost, a resize). */
  settle(): void {
    this.reset();
  }

  destroy(): void {
    this.stop();
    this.clicks = [];
    this.renderer.destroy();
  }

  private reset(): void {
    this.stop();
    this.clicks = [];
    this.lastMove = -Infinity;
    this.prevClient = null;
    this.speed = 0;
    const f = this.frame;
    f.count = 0;
    f.pointer[2] = 0;
    f.pointer[3] = 0;
    f.velocity[0] = 0;
    f.velocity[1] = 0;
    f.live = 0;
    if (this.ready) this.drawStill();
  }

  private drawStill(): void {
    this.frames += 1;
    this.renderer.draw(this.frame);
  }

  private wake(): void {
    if (this.handle === null) {
      this.lastTick = this.now();
      this.handle = this.requestFrame(this.tick);
    }
  }

  private stop(): void {
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (!this.ready || !this.grid) return;
    const now = this.now();
    // 60 fps at most (a 120 Hz display skips every other callback), 30 on battery
    if (now - this.lastDraw < (onBattery ? BATTERY_FRAME_MS : FRAME_MS) - 1) {
      this.handle = this.requestFrame(this.tick);
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    this.lastDraw = now;
    const f = this.frame;
    let box: { left: number; top: number } | null = null;

    this.clicks = this.clicks.filter((click) => now - click.start < CLICK_LIFE * 1000);
    let count = 0;
    let amp = 0;
    let fresh = false;
    for (const click of this.clicks) {
      if (!click.placed) {
        box ??= this.rect();
        click.x = click.clientX - box.left;
        click.y = click.clientY - box.top;
        click.placed = true;
        fresh = true;
      }
      const age = (now - click.start) / 1000;
      const k = count * 4;
      f.clicks[k] = click.x;
      f.clicks[k + 1] = click.y;
      f.clicks[k + 2] = age;
      f.clicks[k + 3] = click.seed;
      amp += clickAmp(age);
      count += 1;
    }
    f.count = count;

    // the pointer: presence eases in on a move and out once it rests
    const moving = now - this.lastMove < LINGER_MS;
    const presence = f.pointer[2];
    const target = moving ? 1 : 0;
    let next = presence + (target - presence) * (1 - Math.exp(-(target > presence ? 8 : 1.6) * dt));
    if (target === 0 && next < 0.01) next = 0;
    if (this.pointerClient && (moving || next > 0)) {
      box ??= this.rect();
      const tx = this.pointerClient.x - box.left;
      const ty = this.pointerClient.y - box.top;
      if (presence <= 0) {
        f.pointer[0] = tx;
        f.pointer[1] = ty;
      } else {
        const follow = 1 - Math.exp(-16 * dt);
        f.pointer[0] += (tx - f.pointer[0]) * follow;
        f.pointer[1] += (ty - f.pointer[1]) * follow;
      }
      // velocity (CSS px per ms), smoothed; the drift follows the pointer
      // slowly and stays where it was left
      const prev = this.prevClient;
      if (prev && now > prev.at) {
        const vx = (this.pointerClient.x - prev.x) / (now - prev.at);
        const vy = (this.pointerClient.y - prev.y) / (now - prev.at);
        const k = 1 - Math.exp(-10 * dt);
        f.velocity[0] += (vx - f.velocity[0]) * k;
        f.velocity[1] += (vy - f.velocity[1]) * k;
      }
      this.prevClient = { x: this.pointerClient.x, y: this.pointerClient.y, at: now };
      const g = this.grid;
      const dx = g.cssWidth > 0 ? (f.pointer[0] / g.cssWidth) * 2 - 1 : 0;
      const dy = g.cssHeight > 0 ? (f.pointer[1] / g.cssHeight) * 2 - 1 : 0;
      const k = 1 - Math.exp(-1.2 * dt);
      f.drift[0] += (Math.max(-1, Math.min(1, dx)) - f.drift[0]) * k;
      f.drift[1] += (Math.max(-1, Math.min(1, dy)) - f.drift[1]) * k;
    }
    if (!moving) {
      const k = Math.exp(-6 * dt);
      f.velocity[0] *= k;
      f.velocity[1] *= k;
    }
    f.pointer[2] = next;
    f.pointer[3] = Math.min(1, Math.hypot(f.velocity[0], f.velocity[1]) / 1.2);

    // the clock: runs while the person interacts, eases to a stop after
    const active = count > 0 || moving;
    const goal = active ? 1 : 0;
    this.speed += (goal - this.speed) * (1 - Math.exp(-(goal > this.speed ? 6 : 1.3) * dt));
    if (goal === 0 && this.speed < 0.01) this.speed = 0;
    f.time = (f.time + dt * this.speed * (1 + this.boost * Math.min(1, amp))) % 3600;
    f.live = Math.max(this.speed, next);

    // the readability map: when a click lands, then every QUIET_REFRESH_MS
    // while the effect runs (the thread may scroll under it)
    if (this.quietRects && (fresh || ((count > 0 || moving) && now - this.quietAt >= QUIET_REFRESH_MS))) {
      box ??= this.rect();
      const origin = box;
      const g = this.grid;
      const rects = Array.from(this.quietRects(), (r) => ({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }));
      this.renderer.setQuiet(quietMap(rects, g.cols, g.rows, QUIET_CELL, this.quiet));
      this.quietAt = now;
    }

    this.frames += 1;
    this.renderer.draw(f);
    const alive = active || this.speed > 0 || next > 0;
    if (alive) this.handle = this.requestFrame(this.tick);
  };
}

// ---------------------------------------------------------------- WebGL ---

function compile(gl: WebGL2RenderingContext, fs: string): WebGLProgram | null {
  const make = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[background-effect] shader:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const v = make(gl.VERTEX_SHADER, VERTEX_SHADER);
  const f = make(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[background-effect] link:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** The WebGL2 renderer of one effect, or null when the GPU cannot run it.
 * `onResize` sets the drawing buffer (the canvas of the conversation; the
 * shared preview canvas of the picker keeps its own size). */
export function createShaderRenderer(gl: WebGL2RenderingContext, effect: BackgroundEffectId, onResize?: (grid: ShaderGrid) => void): ShaderRenderer | null {
  const source = fragmentShader(effect);
  if (!source) return null;
  const program = compile(gl, source);
  if (!program) return null;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const names = ["uRes", "uView", "uScale", "uTime", "uPointer", "uVel", "uDrift", "uCount", "uClicks", "uA", "uB", "uC", "uDark", "uGain", "uMaxA", "uLive", "uQuiet", "uQuietSize"] as const;
  const u = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<(typeof names)[number], WebGLUniformLocation | null>;
  const quietTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, quietTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
  let grid: ShaderGrid | null = null;
  let look: ShaderLook | null = null;

  return {
    resize(next) {
      grid = next;
      onResize?.(next);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, next.cols, next.rows, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(next.cols * next.rows));
    },
    setLook(next) {
      look = next;
    },
    setQuiet(map) {
      if (!grid || map.length !== grid.cols * grid.rows) return;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.RED, gl.UNSIGNED_BYTE, map);
    },
    draw(frame) {
      if (!grid || !look || grid.width === 0 || grid.height === 0) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, grid.width, grid.height);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.uniform1i(u.uQuiet, 0);
      gl.uniform2f(u.uRes, grid.width, grid.height);
      gl.uniform2f(u.uView, grid.cssWidth, grid.cssHeight);
      gl.uniform1f(u.uScale, grid.scale);
      gl.uniform2f(u.uQuietSize, grid.cols * QUIET_CELL, grid.rows * QUIET_CELL);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform4fv(u.uPointer, frame.pointer);
      gl.uniform2fv(u.uVel, frame.velocity);
      gl.uniform2fv(u.uDrift, frame.drift);
      gl.uniform1i(u.uCount, frame.count);
      gl.uniform4fv(u.uClicks, frame.clicks);
      const { a, b, c } = look.colors;
      gl.uniform3f(u.uA, a.r, a.g, a.b);
      gl.uniform3f(u.uB, b.r, b.g, b.b);
      gl.uniform3f(u.uC, c.r, c.g, c.b);
      gl.uniform1f(u.uDark, look.scheme === "dark" ? 1 : 0);
      gl.uniform1f(u.uGain, look.gain);
      gl.uniform1f(u.uMaxA, MAX_ALPHA[look.scheme]);
      gl.uniform1f(u.uLive, frame.live);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    destroy() {
      gl.deleteProgram(program);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteTexture(quietTex);
    },
  };
}

export function isWebGL2(context: unknown): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext === "function" && context instanceof WebGL2RenderingContext;
}

/** The look of an effect from the skin colours the canvas resolves (its
 * `color` is the ink, its border colour the skin's tint). */
export function shaderLook(colors: GlyphColors, palette: PaletteId, gain: number): ShaderLook {
  const theme: { ink: RGB; tint: RGB } = { ink: resolveRgb(colors.ink), tint: resolveRgb(colors.tint, { r: 0.3, g: 0.55, b: 1 }) };
  return { colors: resolvePalette(palette, colors.scheme, theme), scheme: colors.scheme, gain };
}

export interface ShaderMount {
  field: ShaderField;
  unmount: () => void;
}

/** Mounts a shader effect on `canvas`, listening on `pane` with the glyph
 * field's wiring (size, density, skin, visibility, focus, reduced motion,
 * the click and pointer fences). Null without WebGL2 or when the shader does
 * not compile: the caller falls back to the 2D glyph ring. */
export function mountShaderEffect(canvas: HTMLCanvasElement, pane: HTMLElement, effect: BackgroundEffectId): ShaderMount | null {
  let gl: unknown = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!isWebGL2(gl)) return null;
  const context: WebGL2RenderingContext = gl;
  watchBattery();
  const renderer = createShaderRenderer(gl, effect, (grid) => {
    if (canvas.width !== grid.width) canvas.width = grid.width;
    if (canvas.height !== grid.height) canvas.height = grid.height;
  });
  if (!renderer) return null;
  const field = new ShaderField({ renderer, boost: CLICK_BOOST[effect] ?? 0, rect: () => canvas.getBoundingClientRect(), quietRects: () => visibleTextRects(pane, canvas) });
  let last: GlyphColors | null = null;
  let lastPalette = "";
  const engine: GlyphEngine = {
    // the skin's colours, and the palette and the intensity the layer
    // stamps on the canvas (data-palette, data-gain)
    setColors: (colors) => {
      const palette = isPaletteId(canvas.dataset.palette) ? canvas.dataset.palette : "theme";
      if (sameGlyphColors(last, colors) && palette === lastPalette) return;
      last = colors;
      lastPalette = palette;
      field.setLook(shaderLook(colors, palette, colors.gain ?? 1));
    },
    // mountGlyphField sizes the canvas to device px; the renderer brings it
    // back to the shader's drawing size
    resize: (width, height, dpr) => void field.resize(width / (dpr || 1), height / (dpr || 1)),
    ripple: (x, y) => field.click(x, y),
    hover: (x, y) => field.hover(x, y),
    leave: () => field.leave(),
    settle: () => field.settle(),
    destroy: () => {
      field.destroy();
      releaseContextWhenGone(canvas, context);
    },
  };
  const { unmount: unmountField } = mountGlyphField(canvas, pane, engine);
  // on or off battery: the pixel budget changes, draw at the new size
  const stopBattery = onBatteryChange(() => {
    const grid = field.size;
    if (grid) field.resize(grid.cssWidth, grid.cssHeight);
  });
  const unmount = () => {
    stopBattery();
    unmountField();
  };
  return { field, unmount };
}
