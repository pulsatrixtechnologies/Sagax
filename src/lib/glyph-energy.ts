// The energy weave of the conversation's glyph field (Settings > Appearance >
// "Glyph ripple on click"). The same faint monospace field as the 2D ring
// (src/lib/glyph-ripple.ts), drawn by WebGL2 when the machine has it: a click
// sends energy through the glyph grid, per glyph, never a shape over the page.
//
// What a wave looks like (JC, 2026-10-17: "real looking weaves of energies"):
// - a front that runs outward and slows down, its edge torn by noise (fbm),
//   so the lit region is organic, never a circle;
// - behind the front, a body brightest near the click with a soft falloff,
//   threaded by veins of ridged, domain-warped noise that flow outward;
// - glyphs at the front scramble, the hottest ones flicker;
// - two waves that overlap interfere (a coherent sum: bright fringes where
//   their phases agree, nothing extra elsewhere);
// - everything decays exponentially, and each cell keeps a short afterglow
//   (a ping-pong energy texture), so the wave leaves a trail;
// - a faint glow follows the pointer over the conversation.
//
// Cost rules (kept from the 2D ring, JC 2026-10-16):
// - one canvas, pointer-events none, sized to devicePixelRatio;
// - the energy is computed ONCE PER GLYPH CELL (a cols x rows texture, a few
//   tens of thousands of texels), then a full-screen pass only reads
//   textures: the glyph atlas (rendered once per size), the rest field
//   (uploaded once per size) and the energy;
// - requestAnimationFrame runs only while a wave, the pointer glow or the
//   afterglow is alive; at rest nothing runs and the last frame stays;
// - no React in the loop, no allocation per frame, no fillText per frame.

import { CELL, FONT, GLYPHS, LEVELS, mountGlyphField, restCell, sameGlyphColors, type GlyphColors, type GlyphEngine } from "./glyph-ripple";

/** Waves alive at once (a seventh replaces the oldest). */
export const MAX_WAVES = 6;
/** A wave's whole life, from the click to nothing. */
export const WAVE_MS = 1800;
/** How far a front travels (CSS px) over its life. */
export const WAVE_REACH = 540;
/** After the last wave or pointer move, frames keep running this long for the
 * afterglow to fade, then stop. */
export const AFTERGLOW_MS = 650;
/** Afterglow time constant (seconds) of a cell once the energy has left it. */
export const AFTERGLOW_TAU = 0.14;
/** The pointer glow: radius (CSS px) and peak, a whisper next to a click. */
export const HOVER_RADIUS = 62;
export const HOVER_PEAK = 0.22;
/** Under text (paragraphs, lists, code, headings), a lit glyph keeps only
 * this share of its brightness, so a wave never fights what is being read. */
export const QUIET_DIM = 0.62;
/** Text the field stays quiet under, looked up in the visible message rows. */
export const QUIET_SELECTOR = "p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, th, [data-glyph-quiet]";
/** While waves run, the quiet map is refreshed this often (the thread may scroll). */
export const QUIET_REFRESH_MS = 300;
/** The pointer glow fades out this long after the last move. */
export const HOVER_IDLE_MS = 140;

/** Peak opacities of a lit glyph, per scheme. The rest level comes from the
 * 2D field (LEVELS) so the field at rest is the same picture. */
export const ENERGY_LEVELS = {
  dark: { lit: 0.88, water: 0.62 },
  light: { lit: 0.8, water: 0.55 },
} as const;

// ------------------------------------------------------------- pure math ---

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const EASE_K = 3.2;
const EASE_NORM = 1 - Math.exp(-EASE_K);

/** A wave's front at `elapsed` ms: radius and half width (CSS px) and its
 * amplitude (0 once over). The front starts fast and slows down; the
 * amplitude decays exponentially and reaches 0 at the end of the life. */
export function waveAt(elapsed: number): { radius: number; width: number; amp: number } {
  if (elapsed < 0 || elapsed >= WAVE_MS) return { radius: 0, width: 0, amp: 0 };
  const u = elapsed / WAVE_MS;
  const radius = (WAVE_REACH * (1 - Math.exp(-EASE_K * u))) / EASE_NORM;
  const width = 15 + 0.075 * radius;
  const onset = smoothstep(0, 45, elapsed);
  const amp = onset * Math.exp(-elapsed / 620) * (1 - smoothstep(0.62, 1, u));
  return { radius, width, amp };
}

/** The radial envelope of one wave at `distance` (noise left out): the front
 * plus the body that glows behind it, brighter near the click. 0..~1.4. The
 * shader (ENERGY_FS) adds the torn edge, the veins and the interference. */
export function waveEnvelope(distance: number, elapsed: number): number {
  const { radius, width, amp } = waveAt(elapsed);
  if (amp <= 0) return 0;
  const x = (distance - radius) / width;
  const front = Math.exp(-x * x);
  const inside = 1 - smoothstep(-0.6, 0.9, x);
  const core = Math.exp(-distance / (30 + 0.38 * radius));
  const body = inside * (0.18 + 0.82 * core);
  return amp * (front * 0.95 + body * 0.6);
}

/** The energy a cell shows for a summed amplitude: soft saturation, so two
 * waves on one cell brighten it without ever clipping hard. */
export function saturate(sum: number): number {
  return 1 - Math.exp(-1.6 * Math.max(0, sum));
}

// --------------------------------------------------------------- shaders ---

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const NOISE = `
uint hash3(uint x, uint y, uint z) {
  uint h = (x * 0x27d4eb2du) ^ (y * 0x165667b1u) ^ (z * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return h ^ (h >> 16u);
}
float h2(vec2 i) {
  ivec2 k = ivec2(i);
  return float(hash3(uint(k.x), uint(k.y), 11u) & 0xffffu) / 65535.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h2(i), b = h2(i + vec2(1.0, 0.0)), c = h2(i + vec2(0.0, 1.0)), d = h2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 17.1) + 0.15 * vnoise(p * 4.1 - 9.3);
}
`;

// One fragment per glyph cell. r = shown energy (with afterglow),
// g = scramble (how much of a front is on the cell), b = fresh energy.
const ENERGY_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPrev;
uniform float uCellCss;
uniform int uCount;
uniform vec4 uWave[${MAX_WAVES}];   // x, y (CSS px), elapsed (s), seed
uniform vec4 uShape[${MAX_WAVES}];  // radius, width, amp, -
uniform vec4 uHover;                // x, y, strength, time (s)
uniform float uDecay;               // afterglow factor for this frame
uniform float uFresh;               // 1 on a normal frame, 0 to clear
out vec4 outColor;
${NOISE}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 p = (vec2(c) + 0.5) * uCellCss;
  float sum = 0.0;
  float scramble = 0.0;
  float phased = 0.0;
  float unphased = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uCount) break;
    vec4 w = uWave[i];
    vec4 s = uShape[i];
    float R = s.x;
    float W = s.y;
    float amp = s.z;
    vec2 d2 = p - w.xy;
    float d = length(d2);
    float tear = 24.0 + 0.3 * R;
    if (amp <= 0.0 || d > R + 3.0 * W + tear) continue;
    float t = w.z;
    float seed = w.w;
    // torn edge: the distance is pushed around by low-frequency fbm
    // (angular noise tears it at every size, spatial noise adds the slow
    // drift of a big front)
    vec2 dir = d2 / (d + 1e-3);
    vec2 q = p * 0.0105 + vec2(seed, seed * 0.37);
    float torn = 1.0 * (fbm(dir * 2.3 + vec2(seed * 3.1 + t * 0.5, -seed)) - 0.5) + 0.5 * (fbm(q + vec2(t * 0.42, -t * 0.31)) - 0.5);
    float dn = d + torn * 2.0 * tear;
    float x = (dn - R) / W;
    // a softer outer flank: energy leaks ahead of the front
    float front = exp(-x * x / (x > 0.0 ? 1.7 : 1.0));
    float inside = 1.0 - smoothstep(-0.6, 0.9, x);
    // the wake: energy trails behind the front and thins toward the click
    float wake = inside * exp(-max(0.0, R - dn) / (38.0 + 0.32 * R));
    // the flash: the click point itself, bright and quickly gone
    float core = exp(-dn / (22.0 + 0.2 * R)) * exp(-t / 0.32);
    // veins: ridged noise on warped coordinates that flow outward
    vec2 wq = p * 0.017 + vec2(seed * 1.7, -seed) - dir * t * 1.5;
    wq += 1.2 * vec2(vnoise(wq * 0.55 + t * 0.7), vnoise(wq * 0.55 + 9.1 - t * 0.7)) - 0.6;
    float ridge = 1.0 - abs(2.0 * vnoise(wq) - 1.0);
    float vein = ridge * ridge * ridge * ridge;
    float e = amp * (front * (0.65 + 0.95 * vein) + wake * (0.08 + 1.0 * vein) + core * 1.1);
    float body = wake;
    sum += e;
    scramble += amp * front;
    // interference: a coherent ring train behind each front
    float a = amp * (front + 0.6 * body);
    phased += a * cos((dn - R) * 0.16 - t * 9.0);
    unphased += a * a;
  }
  // only the cross terms (two waves on one cell) add: bright fringes where
  // their phases agree
  sum += 0.45 * max(0.0, phased * phased - unphased);
  if (uHover.z > 0.0) {
    vec2 hp = p - uHover.xy;
    float hd = length(hp);
    float hr = ${HOVER_RADIUS.toFixed(1)} * (0.8 + 0.45 * fbm(p * 0.03 + uHover.w * 0.6));
    float glow = exp(-(hd * hd) / (hr * hr));
    vec2 hq = p * 0.024 + vec2(uHover.w * 0.5, -uHover.w * 0.4);
    float ridge = 1.0 - abs(2.0 * vnoise(hq + 0.8 * vnoise(hq * 0.7 - uHover.w * 0.3)) - 1.0);
    sum += uHover.z * ${HOVER_PEAK.toFixed(2)} * glow * (0.45 + 0.9 * ridge * ridge);
  }
  float fresh = (1.0 - exp(-1.6 * sum)) * uFresh;
  float prev = texelFetch(uPrev, c, 0).r * uDecay * uFresh;
  outColor = vec4(max(fresh, prev), clamp(scramble, 0.0, 1.0) * uFresh, fresh, 1.0);
}
`;

// One fragment per device pixel: which glyph, which colour, how opaque.
const COMPOSITE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uAtlas;
uniform sampler2D uRest;
uniform sampler2D uEnergy;
uniform sampler2D uQuiet;  // 1 where text sits: lit glyphs stay low there
uniform int uCellPx;
uniform float uHeight;
uniform int uGlyphs;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uTint;
uniform vec3 uHot;
uniform vec3 uLevels;   // rest, lit, water (lit level of an empty cell)
out vec4 outColor;
${NOISE}
const float QUIET_DIM = ${QUIET_DIM.toFixed(2)};
void main() {
  ivec2 px = ivec2(int(gl_FragCoord.x), int(uHeight - gl_FragCoord.y));
  ivec2 cell = px / uCellPx;
  ivec2 local = px - cell * uCellPx;
  vec4 rest = texelFetch(uRest, cell, 0);
  vec4 en = texelFetch(uEnergy, cell, 0);
  float E = en.r;
  float restAlpha = rest.g;
  if (E < 0.004 && restAlpha <= 0.0) { outColor = vec4(0.0); return; }
  int glyph = int(rest.r * 255.0 + 0.5);
  // scramble: a front reshuffles its glyphs ~22 times a second; the hot
  // body flickers now and then
  uint tick = uint(uTime * 22.0);
  float roll = float(hash3(uint(cell.x), uint(cell.y), tick) & 0xffffu) / 65535.0;
  if (roll < en.g * 0.92 + E * E * 0.08) glyph = int(hash3(uint(cell.x), uint(cell.y), tick + 7919u) % uint(uGlyphs));
  ivec2 at = ivec2(glyph * uCellPx + local.x, local.y);
  float mask = texelFetch(uAtlas, at, 0).a;
  // bloom: a hot glyph glows past its strokes (a soft halo from 8 taps,
  // clamped to its own cell so it never reads its neighbour)
  float halo = 0.0;
  float quiet = texelFetch(uQuiet, cell, 0).r;
  if (E > 0.35 && quiet < 0.5) {
    ivec2 lo = ivec2(glyph * uCellPx, 0);
    ivec2 hi = lo + ivec2(uCellPx - 1);
    int r = max(1, uCellPx / 10);
    for (int k = 0; k < 8; k++) {
      float ang = float(k) * 0.785398;
      ivec2 o = ivec2(round(vec2(cos(ang), sin(ang)) * float(r)));
      halo += texelFetch(uAtlas, clamp(at + o, lo, hi), 0).a;
    }
    halo = halo / 8.0 * smoothstep(0.35, 1.0, E) * 0.55;
  }
  float cover = max(mask, halo);
  if (cover <= 0.0) { outColor = vec4(0.0); return; }
  float restA = restAlpha * uLevels.x;
  float lit = mix(uLevels.z, uLevels.y, restAlpha) * (1.0 - QUIET_DIM * quiet);
  float k = E * E * (1.6 - 0.6 * E);
  float a = mix(restA, lit, k);
  // flicker: the hottest glyphs breathe a little, cell by cell
  float flick = float(hash3(uint(cell.x), uint(cell.y), uint(uTime * 30.0) + 31u) & 0xffu) / 255.0;
  a *= 1.0 - 0.18 * en.g * flick;
  vec3 color = mix(uInk, uTint, smoothstep(0.0, 0.12, E));
  color = mix(color, uHot, smoothstep(0.45, 1.0, E));
  float alpha = clamp(a, 0.0, 1.0) * cover;
  outColor = vec4(color * alpha, alpha);
}
`;

// --------------------------------------------------------------- engine ---

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface EnergyColors {
  ink: RGB;
  tint: RGB;
  hot: RGB;
  scheme: "light" | "dark";
  /** The intensity's multiplier of the opacities (1 by default). */
  gain?: number;
}

/** The frame the renderer draws: waves in CSS px relative to the canvas. */
export interface EnergyFrame {
  time: number;
  count: number;
  waves: Float32Array;   // MAX_WAVES * 4: x, y, elapsed s, seed
  shapes: Float32Array;  // MAX_WAVES * 4: radius, width, amp, 0
  hover: Float32Array;   // x, y, strength, time s
  decay: number;
  /** false: no energy at all, draw the field at rest */
  live: boolean;
}

export interface EnergyGrid {
  width: number;
  height: number;
  dpr: number;
  cellPx: number;
  cols: number;
  rows: number;
}

/** What draws (WebGL in the app, a fake in the tests). */
export interface EnergyRenderer {
  resize(grid: EnergyGrid): void;
  setColors(colors: EnergyColors): void;
  /** cols x rows, 255 where text sits (the readability map). */
  setQuiet(map: Uint8Array): void;
  draw(frame: EnergyFrame): void;
  destroy(): void;
}

interface Wave {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  placed: boolean;
  start: number;
  seed: number;
}

export interface EnergyFieldOptions {
  renderer: EnergyRenderer;
  rect: () => { left: number; top: number };
  now?: () => number;
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** The text boxes on screen, in client px (the readability map). Called
   * inside a frame when a wave starts and every QUIET_REFRESH_MS while
   * waves run, never in an input handler. */
  quietRects?: () => ArrayLike<{ left: number; top: number; right: number; bottom: number }>;
}

/** Marks the cells under `rects` (CSS px relative to the canvas) in a
 * cols x rows map, 255 = text. A rect covers a cell when it overlaps most of
 * it, so a line of text quiets its own row of glyphs, not the next. */
export function quietMap(
  rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }>,
  cols: number,
  rows: number,
  cellCss: number,
  out = new Uint8Array(cols * rows),
): Uint8Array {
  out.fill(0);
  for (let k = 0; k < rects.length; k += 1) {
    const r = rects[k];
    const c0 = Math.max(0, Math.round(r.left / cellCss));
    const c1 = Math.min(cols - 1, Math.round(r.right / cellCss) - 1);
    const r0 = Math.max(0, Math.round(r.top / cellCss));
    const r1 = Math.min(rows - 1, Math.round(r.bottom / cellCss) - 1);
    for (let row = r0; row <= r1; row += 1) out.fill(255, row * cols + c0, row * cols + c1 + 1);
  }
  return out;
}

/** The waves, the pointer glow and the frame loop, outside any GPU code. */
export class EnergyField {
  private readonly renderer: EnergyRenderer;
  private readonly rect: () => { left: number; top: number };
  private readonly now: () => number;
  private readonly requestFrame: (callback: (time: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly quietRects: EnergyFieldOptions["quietRects"];
  private quiet = new Uint8Array(0);
  private quietAt = -Infinity;
  private waves: Wave[] = [];
  private handle: number | null = null;
  private seed = 1;
  private ready = false;
  private grid: EnergyGrid | null = null;
  private lastFrame = 0;
  private liveUntil = 0;
  private hoverX = 0;
  private hoverY = 0;
  private hoverClient: { x: number; y: number } | null = null;
  private hoverStrength = 0;
  private lastMove = -Infinity;
  private readonly frame: EnergyFrame = {
    time: 0,
    count: 0,
    waves: new Float32Array(MAX_WAVES * 4),
    shapes: new Float32Array(MAX_WAVES * 4),
    hover: new Float32Array(4),
    decay: 0,
    live: false,
  };

  /** Frames drawn since mount (the tests and the bench read it). */
  frames = 0;

  constructor(options: EnergyFieldOptions) {
    this.renderer = options.renderer;
    this.rect = options.rect;
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.quietRects = options.quietRects;
  }

  get animating(): boolean {
    return this.handle !== null;
  }

  get waveCount(): number {
    return this.waves.length;
  }

  get size(): EnergyGrid | null {
    return this.grid;
  }

  /** New canvas size (device px) or density: a new grid, waves dropped, the
   * field drawn once at rest. */
  resize(width: number, height: number, dpr: number): void {
    const ratio = dpr > 0 ? dpr : 1;
    const cellPx = Math.max(4, Math.round(CELL * ratio));
    this.grid = { width, height, dpr: ratio, cellPx, cols: Math.max(0, Math.ceil(width / cellPx)), rows: Math.max(0, Math.ceil(height / cellPx)) };
    this.renderer.resize(this.grid);
    this.quiet = new Uint8Array(this.grid.cols * this.grid.rows);
    this.quietAt = -Infinity;
    this.ready = this.grid.cols > 0 && this.grid.rows > 0;
    this.reset();
  }

  setColors(colors: EnergyColors): void {
    this.renderer.setColors(colors);
    if (this.ready) this.reset();
  }

  /** A click at client coordinates. False when the field cannot draw yet. */
  wave(clientX: number, clientY: number): boolean {
    if (!this.ready) return false;
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.seed = (this.seed + 1) | 0;
    this.waves.push({ clientX, clientY, x: 0, y: 0, placed: false, start: this.now(), seed: ((this.seed * 7919) % 997) / 7.3 });
    this.wake();
    return true;
  }

  /** The pointer moved over the conversation. */
  hover(clientX: number, clientY: number): void {
    if (!this.ready) return;
    this.hoverClient = { x: clientX, y: clientY };
    this.lastMove = this.now();
    this.wake();
  }

  /** The pointer left the conversation: the glow fades. */
  leave(): void {
    this.lastMove = -Infinity;
  }

  /** Drops every wave and the glow and draws the field at rest (a hidden
   * window, a resize, a new skin). */
  settle(): void {
    this.reset();
  }

  destroy(): void {
    this.stop();
    this.waves = [];
    this.renderer.destroy();
  }

  private reset(): void {
    this.stop();
    this.waves = [];
    this.hoverStrength = 0;
    this.lastMove = -Infinity;
    this.liveUntil = 0;
    if (!this.ready) return;
    const f = this.frame;
    f.count = 0;
    f.live = false;
    f.decay = 0;
    f.hover[2] = 0;
    f.time = this.now() / 1000;
    this.renderer.draw(f);
  }

  private wake(): void {
    if (this.handle === null) {
      this.lastFrame = this.now();
      this.handle = this.requestFrame(this.tick);
    }
  }

  private stop(): void {
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (!this.ready) return;
    const now = this.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.frames += 1;
    const f = this.frame;

    this.waves = this.waves.filter((wave) => now - wave.start < WAVE_MS);
    let box: { left: number; top: number } | null = null;
    let count = 0;
    let fresh = false;
    for (const wave of this.waves) {
      if (!wave.placed) {
        fresh = true;
        box ??= this.rect();
        wave.x = wave.clientX - box.left;
        wave.y = wave.clientY - box.top;
        wave.placed = true;
      }
      const elapsed = now - wave.start;
      const { radius, width, amp } = waveAt(elapsed);
      const k = count * 4;
      f.waves[k] = wave.x;
      f.waves[k + 1] = wave.y;
      f.waves[k + 2] = elapsed / 1000;
      f.waves[k + 3] = wave.seed;
      f.shapes[k] = radius;
      f.shapes[k + 1] = width;
      f.shapes[k + 2] = amp;
      f.shapes[k + 3] = 0;
      count += 1;
    }
    f.count = count;
    if (count > 0 && this.quietRects && this.grid && (fresh || now - this.quietAt >= QUIET_REFRESH_MS)) {
      box ??= this.rect();
      const origin = box;
      const rects = Array.from(this.quietRects(), (r) => ({ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }));
      this.renderer.setQuiet(quietMap(rects, this.grid.cols, this.grid.rows, this.grid.cellPx / this.grid.dpr, this.quiet));
      this.quietAt = now;
    }

    // the pointer glow eases in on a move and out once the pointer rests
    const target = now - this.lastMove < HOVER_IDLE_MS ? 1 : 0;
    const rate = target > this.hoverStrength ? 10 : 4;
    this.hoverStrength += (target - this.hoverStrength) * (1 - Math.exp(-rate * dt));
    if (this.hoverStrength < 0.01 && target === 0) this.hoverStrength = 0;
    if (this.hoverClient && this.hoverStrength > 0) {
      box ??= this.rect();
      const tx = this.hoverClient.x - box.left;
      const ty = this.hoverClient.y - box.top;
      if (f.hover[2] <= 0) {
        this.hoverX = tx;
        this.hoverY = ty;
      } else {
        // a light follow, so the glow trails the pointer a little
        const follow = 1 - Math.exp(-18 * dt);
        this.hoverX += (tx - this.hoverX) * follow;
        this.hoverY += (ty - this.hoverY) * follow;
      }
    }
    f.hover[0] = this.hoverX;
    f.hover[1] = this.hoverY;
    f.hover[2] = this.hoverStrength;
    f.hover[3] = (now / 1000) % 1000;
    f.time = (now / 1000) % 1000;
    f.decay = Math.exp(-dt / AFTERGLOW_TAU);

    const energized = count > 0 || this.hoverStrength > 0;
    if (energized) this.liveUntil = now + AFTERGLOW_MS;
    f.live = energized || now < this.liveUntil;
    this.renderer.draw(f);
    if (f.live) this.handle = this.requestFrame(this.tick);
  };
}

// ---------------------------------------------------------------- WebGL ---

/** Parses any CSS colour the browser resolves (rgb(), color(srgb ...), oklch
 * ...) by painting it on a 1x1 canvas. */
export function resolveRgb(color: string, fallback: RGB = { r: 0.5, g: 0.5, b: 0.5 }): RGB {
  try {
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(1, 1) : Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx || typeof ctx.getImageData !== "function") return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return fallback;
    return { r: r / 255, g: g / 255, b: b / 255 };
  } catch {
    return fallback;
  }
}

/** The colours of a scheme: ink at rest, the skin's tint when lit, and a hot
 * core (the tint toward white on dark skins, a deeper tint on light ones). */
export function energyColors(colors: GlyphColors): EnergyColors {
  const ink = resolveRgb(colors.ink);
  const tint = resolveRgb(colors.tint, { r: 0.3, g: 0.55, b: 1 });
  const hot = colors.scheme === "dark"
    ? { r: tint.r + (1 - tint.r) * 0.38, g: tint.g + (1 - tint.g) * 0.38, b: tint.b + (1 - tint.b) * 0.38 }
    : { r: tint.r * 0.72, g: tint.g * 0.72, b: tint.b * 0.72 };
  return { ink, tint, hot, scheme: colors.scheme, gain: colors.gain ?? 1 };
}

const FONT_STACK = '"SF Mono", ui-monospace, Menlo, Consolas, "Liberation Mono", monospace';

/** The glyph mask atlas, one row, alpha only. */
function glyphMask(cellPx: number, fontPx: number): HTMLCanvasElement | OffscreenCanvas {
  const width = cellPx * GLYPHS.length;
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, cellPx) : Object.assign(document.createElement("canvas"), { width, height: cellPx });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return canvas;
  ctx.font = `500 ${fontPx}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  for (let k = 0; k < GLYPHS.length; k += 1) ctx.fillText(GLYPHS[k], k * cellPx + cellPx / 2, cellPx / 2 + 0.5);
  return canvas;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const make = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[glyph-energy] shader:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const v = make(gl.VERTEX_SHADER, vs);
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
    console.warn("[glyph-energy] link:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Gives a canvas's WebGL context back once the canvas has left the page
 * (switching effects would otherwise pile up contexts until the browser drops
 * the oldest). A canvas still in the page keeps it: React mounts an effect
 * twice on the same canvas in development, and a lost context never compiles
 * again. */
export function releaseContextWhenGone(canvas: HTMLCanvasElement, context: WebGL2RenderingContext): void {
  setTimeout(() => {
    if (!canvas.isConnected) context.getExtension("WEBGL_lose_context")?.loseContext();
  }, 0);
}

/** Whether `context` is a real WebGL2 context (the DOM tests hand out a fake
 * 2D context for every getContext call). */
export function isWebGL2(context: unknown): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext === "function" && context instanceof WebGL2RenderingContext;
}

/** The WebGL2 renderer, or null when the GPU cannot run it (the caller falls
 * back to the 2D ring). */
export function createWebGLRenderer(gl: WebGL2RenderingContext): EnergyRenderer | null {
  const energyProgram = compile(gl, VS, ENERGY_FS);
  const compositeProgram = compile(gl, VS, COMPOSITE_FS);
  if (!energyProgram || !compositeProgram) return null;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const u = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
  const E = {
    prev: u(energyProgram, "uPrev"),
    cellCss: u(energyProgram, "uCellCss"),
    count: u(energyProgram, "uCount"),
    wave: u(energyProgram, "uWave"),
    shape: u(energyProgram, "uShape"),
    hover: u(energyProgram, "uHover"),
    decay: u(energyProgram, "uDecay"),
    fresh: u(energyProgram, "uFresh"),
  };
  const C = {
    atlas: u(compositeProgram, "uAtlas"),
    rest: u(compositeProgram, "uRest"),
    energy: u(compositeProgram, "uEnergy"),
    quiet: u(compositeProgram, "uQuiet"),
    cellPx: u(compositeProgram, "uCellPx"),
    height: u(compositeProgram, "uHeight"),
    glyphs: u(compositeProgram, "uGlyphs"),
    time: u(compositeProgram, "uTime"),
    ink: u(compositeProgram, "uInk"),
    tint: u(compositeProgram, "uTint"),
    hot: u(compositeProgram, "uHot"),
    levels: u(compositeProgram, "uLevels"),
  };

  const atlasTex = texture(gl);
  const restTex = texture(gl);
  const quietTex = texture(gl);
  const energyTex = [texture(gl), texture(gl)];
  const fbo = [gl.createFramebuffer(), gl.createFramebuffer()];
  let current = 0;
  let grid: EnergyGrid | null = null;
  let colors: EnergyColors | null = null;

  return {
    resize(next) {
      grid = next;
      if (next.cols === 0 || next.rows === 0) return;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, glyphMask(next.cellPx, FONT * next.dpr) as TexImageSource);
      const rest = new Uint8Array(next.cols * next.rows * 2);
      for (let row = 0; row < next.rows; row += 1) {
        for (let col = 0; col < next.cols; col += 1) {
          const cell = restCell(col, row);
          const i = (row * next.cols + col) * 2;
          rest[i] = cell.glyph;
          rest[i + 1] = Math.round(cell.alpha * 255);
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, restTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, next.cols, next.rows, 0, gl.RG, gl.UNSIGNED_BYTE, rest);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, next.cols, next.rows, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(next.cols * next.rows));
      for (let k = 0; k < 2; k += 1) {
        gl.bindTexture(gl.TEXTURE_2D, energyTex[k]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, next.cols, next.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[k]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, energyTex[k], 0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    setColors(next) {
      colors = next;
    },
    setQuiet(map) {
      if (!grid || map.length !== grid.cols * grid.rows) return;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.cols, grid.rows, gl.RED, gl.UNSIGNED_BYTE, map);
    },
    draw(frame) {
      if (!grid || !colors || grid.cols === 0) return;
      const level = LEVELS[colors.scheme];
      const lit = ENERGY_LEVELS[colors.scheme];
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(vao);

      // pass 1: energy per glyph cell, reading last frame's for the afterglow
      const next = 1 - current;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[next]);
      gl.viewport(0, 0, grid.cols, grid.rows);
      gl.useProgram(energyProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, energyTex[current]);
      gl.uniform1i(E.prev, 0);
      gl.uniform1f(E.cellCss, grid.cellPx / grid.dpr);
      gl.uniform1i(E.count, frame.count);
      gl.uniform4fv(E.wave, frame.waves);
      gl.uniform4fv(E.shape, frame.shapes);
      gl.uniform4fv(E.hover, frame.hover);
      gl.uniform1f(E.decay, frame.decay);
      gl.uniform1f(E.fresh, frame.live ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      current = next;

      // pass 2: the glyphs, every device pixel
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, grid.width, grid.height);
      gl.useProgram(compositeProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, restTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, energyTex[current]);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, quietTex);
      gl.uniform1i(C.quiet, 3);
      gl.uniform1i(C.atlas, 0);
      gl.uniform1i(C.rest, 1);
      gl.uniform1i(C.energy, 2);
      gl.uniform1i(C.cellPx, grid.cellPx);
      gl.uniform1f(C.height, grid.height);
      gl.uniform1i(C.glyphs, GLYPHS.length);
      gl.uniform1f(C.time, frame.time);
      gl.uniform3f(C.ink, colors.ink.r, colors.ink.g, colors.ink.b);
      gl.uniform3f(C.tint, colors.tint.r, colors.tint.g, colors.tint.b);
      gl.uniform3f(C.hot, colors.hot.r, colors.hot.g, colors.hot.b);
      const gain = colors.gain ?? 1;
      gl.uniform3f(C.levels, level.rest * gain, Math.min(1, lit.lit * gain), Math.min(1, lit.water * gain));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      gl.deleteProgram(energyProgram);
      gl.deleteProgram(compositeProgram);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      for (const tex of [atlasTex, restTex, quietTex, ...energyTex]) gl.deleteTexture(tex);
      for (const fb of fbo) gl.deleteFramebuffer(fb);
    },
  };
}

// ------------------------------------------------------------ DOM wiring ---

/** The message rows of the transcript (MessageActions.tsx MESSAGE_ROW). */
const ROW_SELECTOR = "[data-message-row]";
const MAX_QUIET_RECTS = 400;

/** The text boxes the canvas shows behind: only rows on screen are opened
 * (a long thread costs one rect per row, not one per paragraph). Without
 * rows (the gallery, an empty thread), the pane's own text blocks. */
export function visibleTextRects(pane: HTMLElement, canvas: HTMLElement): DOMRect[] {
  const view = canvas.getBoundingClientRect();
  const out: DOMRect[] = [];
  const take = (root: ParentNode) => {
    for (const el of root.querySelectorAll(QUIET_SELECTOR)) {
      if (out.length >= MAX_QUIET_RECTS) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > view.top && r.top < view.bottom && r.width > 0) out.push(r);
    }
  };
  const rows = pane.querySelectorAll(ROW_SELECTOR);
  if (rows.length === 0) {
    take(pane);
    return out;
  }
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (r.bottom <= view.top || r.top >= view.bottom) continue;
    take(row);
  }
  return out;
}

/** The energy weave on `canvas` as a GlyphEngine, or null when the canvas
 * has no WebGL2 (or the shaders do not compile). */
export function createEnergyEngine(canvas: HTMLCanvasElement, pane: HTMLElement): { engine: GlyphEngine; field: EnergyField } | null {
  let gl: unknown = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!isWebGL2(gl)) return null;
  const context: WebGL2RenderingContext = gl;
  const renderer = createWebGLRenderer(gl);
  if (!renderer) return null;
  const field = new EnergyField({ renderer, rect: () => canvas.getBoundingClientRect(), quietRects: () => visibleTextRects(pane, canvas) });
  let last: GlyphColors | null = null;
  const engine: GlyphEngine = {
    setColors: (colors) => {
      if (sameGlyphColors(last, colors)) return;
      last = colors;
      field.setColors(energyColors(colors));
    },
    resize: (width, height, dpr) => field.resize(width, height, dpr),
    ripple: (x, y) => field.wave(x, y),
    hover: (x, y) => field.hover(x, y),
    leave: () => field.leave(),
    settle: () => field.settle(),
    destroy: () => {
      field.destroy();
      releaseContextWhenGone(canvas, context);
    },
  };
  return { engine, field };
}

/** Mounts the glyph field: the WebGL energy weave when the machine has it,
 * else the 2D ring. Same listeners, same rules (mountGlyphField). */
export function mountGlyphEnergy(canvas: HTMLCanvasElement, pane: HTMLElement): { energy: EnergyField | null; unmount: () => void } {
  const made = createEnergyEngine(canvas, pane);
  const { unmount } = mountGlyphField(canvas, pane, made?.engine ?? null);
  return { energy: made?.field ?? null, unmount };
}
