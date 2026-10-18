// The fragment shaders of the background effects (src/lib/background-effects.ts).
// Each effect is one function `vec4 effect(vec2 p)`: p is the pixel in CSS px
// from the top left of the conversation pane, the result is a colour and an
// alpha (not premultiplied). The shared prelude gives the uniforms and the
// noise; the shared footer applies the intensity, the readability map (text
// boxes on screen) and the alpha cap per scheme, then premultiplies.
//
// Every effect answers the same three inputs, its own way:
// - uTime: the effect's clock. It runs only while the person interacts and
//   eases to a stop afterwards (background-engine.ts), so a frozen frame is
//   always a frame of the effect, never a blank;
// - uPointer: where the mouse or pen is, how present it is (eases in and
//   out) and how fast it moves; uVel its smoothed velocity; uDrift a slow,
//   persistent offset of the pointer from the centre (a camera that stays);
// - uClicks: up to MAX_CLICKS clicks, each with its age in seconds.

import type { BackgroundEffectId } from "./background-effects";

export const MAX_CLICKS = 6;
/** A click's whole life in an effect, seconds. */
export const CLICK_LIFE = 2.6;

export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;
uniform vec2 uView;
uniform float uScale;
uniform float uTime;
uniform vec4 uPointer;
uniform vec2 uVel;
uniform vec2 uDrift;
uniform int uCount;
uniform vec4 uClicks[${MAX_CLICKS}];
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uDark;
uniform float uGain;
uniform float uMaxA;
uniform float uLive;
uniform sampler2D uQuiet;
uniform vec2 uQuietSize;
out vec4 outColor;

const float PI = 3.14159265;
const int MAXC = ${MAX_CLICKS};
const float CLICK_LIFE = ${CLICK_LIFE.toFixed(2)};

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s / 0.9375;
}
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = ROT * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s / 0.875;
}
// smoothstep with edges in either order (reversed edges are undefined in
// GLSL ES), and a square that never takes pow() of a negative base
float sstep(float a, float b, float x) { return a < b ? smoothstep(a, b, x) : 1.0 - smoothstep(b, a, x); }
float sq(float x) { return x * x; }
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
// a click's envelope: quick attack, exponential decay, nothing at CLICK_LIFE
float clickAmp(float age) {
  return sstep(0.0, 0.05, age) * exp(-age * 1.15) * (1.0 - sstep(CLICK_LIFE - 0.7, CLICK_LIFE, age));
}
// a front that starts fast and slows down, reaching about reach px
float clickFront(float age, float reach, float k) { return reach * (1.0 - exp(-age * k)); }
float pointerGlow(vec2 p, float r) {
  vec2 d = p - uPointer.xy;
  return uPointer.z * exp(-dot(d, d) / (r * r));
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}
`;

const FOOTER = `
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec4 c = effect(p);
  float q = texture(uQuiet, p / uQuietSize).r;
  float a = clamp(c.a * uGain, 0.0, uMaxA) * (1.0 - 0.6 * q * uLive);
  outColor = vec4(clamp(c.rgb, 0.0, 1.0) * a, a);
}
`;

// ------------------------------------------------------------- effects ---

/** Digital rain: columns of dot-matrix glyphs falling at their own pace. The
 * pointer heats the columns under it (brighter, faster scrambling); a click
 * sends a shock ring through the rain that flares and reshuffles it. */
const MATRIX = `
vec4 effect(vec2 p) {
  const float CW = 14.0;
  const float CH = 17.0;
  float col = floor(p.x / CW);
  float row = floor(p.y / CH);
  vec2 cellC = vec2((col + 0.5) * CW, (row + 0.5) * CH);
  float hc = hash12(vec2(col, 3.1));
  float speed = 4.0 + 8.0 * hc;
  float len = 10.0 + 22.0 * hash12(vec2(col, 7.7));
  float period = len + 12.0 + 30.0 * hash12(vec2(col, 1.3));
  float k = mod(uTime * speed + hash12(vec2(col, 9.2)) * period - row, period);
  float trail = k < len ? pow(1.0 - k / len, 2.2) : 0.0;
  float isHead = k < 1.0 ? 1.0 : 0.0;
  float k2 = mod(uTime * speed * 0.61 + hash12(vec2(col, 4.4)) * period - row, period);
  float len2 = len * 0.55;
  float trail2 = k2 < len2 ? 0.5 * sq(1.0 - k2 / len2) : 0.0;
  float tr = max(trail, trail2);
  vec2 dp = cellC - uPointer.xy;
  float near = uPointer.z * exp(-(dp.x * dp.x) / (80.0 * 80.0)) * exp(-(dp.y * dp.y) / (240.0 * 240.0));
  float shock = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float d = length(cellC - c.xy);
    float R = clickFront(c.z, 620.0, 1.5);
    float x = (d - R) / 30.0;
    float amp = clickAmp(c.z);
    shock += amp * (exp(-x * x) + 0.4 * (1.0 - sstep(-1.0, 0.4, x)) * exp(-c.z * 1.6));
  }
  shock = min(shock, 1.6);
  vec2 local = (p - vec2(col * CW, row * CH)) / vec2(CW, CH);
  float rate = 1.2 + 16.0 * clamp(isHead + shock + near, 0.0, 1.5);
  float tick = floor(uTime * rate + hash12(vec2(col, row)) * 7.0);
  vec2 g = floor((local - vec2(0.16, 0.12)) / vec2(0.68, 0.76) * vec2(5.0, 7.0));
  float inside = step(0.0, g.x) * step(g.x, 4.0) * step(0.0, g.y) * step(g.y, 6.0);
  float gx = min(g.x, 4.0 - g.x);
  float bit = step(0.56, hash12(vec2(col * 7.0 + gx + tick * 13.0, row * 11.0 + g.y + tick * 3.0)));
  vec2 pix = fract((local - vec2(0.16, 0.12)) / vec2(0.68, 0.76) * vec2(5.0, 7.0)) - 0.5;
  float dot5 = sstep(0.5, 0.25, length(pix));
  float on = inside * bit * dot5;
  float headLit = isHead * step(0.001, trail);
  vec3 color = mix(uB, uA, sstep(0.0, 0.55, tr));
  color = mix(color, uC, clamp(headLit * 0.9 + shock * 0.8 + near * 0.35, 0.0, 1.0));
  float a = on * (0.03 + 0.34 * tr + 0.3 * headLit + 0.6 * shock + 0.25 * near * (0.3 + tr));
  return vec4(color, a * mix(0.7, 1.0, uLive));
}
`;

/** A starfield in depth: four layers fly toward the viewer while the effect
 * runs, the vanishing point follows the pointer, stars near the pointer are
 * magnified, and a click is a warp jump (stars streak away from it, the
 * engine speeds the clock up). */
const STARFIELD = `
float starLayer(vec2 q, float L, float z) {
  float scale = mix(16.0, 1.2, z);
  vec2 uv = q * scale + L * 17.31;
  vec2 id = floor(uv);
  vec2 f = fract(uv) - 0.5;
  vec2 h = hash22(id + L * 3.17);
  float present = step(0.5, hash12(id * 1.71 + L));
  vec2 d = f - (h - 0.5) * 0.6;
  float size = (0.012 + 0.026 * h.y) * mix(0.7, 1.6, z);
  float r2 = dot(d, d) / (size * size);
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 4.0 * h.x) + h.y * 40.0);
  float fade = sstep(0.0, 0.3, z) * (1.0 - sstep(0.85, 1.0, z));
  return present * fade * tw * (exp(-r2) + 0.25 * exp(-r2 * 0.25));
}
vec4 effect(vec2 p) {
  vec2 center = uView * 0.5 + uDrift * uView * vec2(0.22, 0.18);
  vec2 q = (p - center) / uView.y;
  vec2 dp = p - uPointer.xy;
  float lens = pointerGlow(p, 150.0);
  q -= dp / uView.y * lens * 0.25;
  vec2 warpDir = normalize(q + 1e-4);
  float warp = 0.0;
  float ring = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    vec2 r = p - c.xy;
    float d = length(r);
    float amp = clickAmp(c.z);
    float w = amp * exp(-d / 520.0);
    warpDir = normalize(mix(warpDir, r / max(d, 1.0), clamp(w * 2.0, 0.0, 1.0)));
    warp += w;
    float R = clickFront(c.z, 760.0, 1.6);
    float x = (d - R) / 40.0;
    ring += amp * exp(-x * x);
  }
  warp = min(warp, 1.0);
  int taps = warp > 0.02 ? 6 : 1;
  float lum = 0.0;
  float hot = 0.0;
  for (int L = 0; L < 4; L++) {
    float fl = float(L);
    float z = fract(fl * 0.25 + uTime * 0.045);
    float s = 0.0;
    for (int k = 0; k < 6; k++) {
      if (k >= taps) break;
      // a streak: the same stars sampled back along the warp direction
      float back = float(k) / 5.0;
      s = max(s, starLayer(q - warpDir * back * warp * (0.012 + 0.05 * z), fl, z) * (1.0 - 0.75 * back));
    }
    lum += s;
    hot += s * z;
  }
  float neb = fbm3(q * 1.6 + vec2(uTime * 0.01, 3.0) + uDrift * 0.2);
  float cloud = sstep(0.5, 0.95, neb) * 0.35;
  lum *= 1.0 + 1.6 * lens + 1.2 * ring;
  vec3 color = mix(uA, uC, clamp(hot / max(lum, 1e-3) + ring * 0.5, 0.0, 1.0));
  vec3 outc = (color * lum + uB * cloud) / max(lum + cloud, 1e-3);
  float a = 0.55 * lum + 0.12 * cloud + 0.1 * ring;
  return vec4(outc, a * mix(0.75, 1.0, uLive));
}
`;

/** Northern lights: three curtains of rays folding slowly across the pane.
 * The pointer pulls the nearest curtain toward it and brightens it; a click
 * sends a surge of light running sideways along the curtains. */
const AURORA = `
vec4 effect(vec2 p) {
  float t = uTime;
  vec3 col = vec3(0.0);
  float acc = 0.0;
  float pullX = uPointer.z * exp(-sq((p.x - uPointer.x) / 240.0));
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float fold = fbm3(vec2(p.x * 0.0021 + fl * 3.7, t * 0.07 + fl * 1.9)) - 0.5;
    float y0 = (0.16 + 0.27 * fl + 0.24 * fold) * uView.y;
    float near = pullX * exp(-abs(uPointer.y - y0) / 260.0);
    y0 = mix(y0, uPointer.y - 40.0, 0.4 * near);
    float pulse = 0.0;
    for (int i = 0; i < MAXC; i++) {
      if (i >= uCount) break;
      vec4 c = uClicks[i];
      float dx = abs(p.x - c.x);
      float R = clickFront(c.z, 900.0, 1.2);
      float xx = (dx - R) / 70.0;
      float amp = clickAmp(c.z) * exp(-abs(y0 - c.y) / 380.0);
      pulse += amp * (exp(-xx * xx) + 0.6 * exp(-dx / 140.0) * exp(-c.z * 2.0));
    }
    float dy = p.y - y0;
    float rays = 0.45 + 0.55 * vnoise(vec2(p.x * 0.05 + fl * 9.0, t * 0.6 + fl));
    rays *= 0.55 + 0.45 * vnoise(vec2(p.x * 0.011 - t * 0.25, fl * 4.0));
    float h = dy > 0.0 ? exp(-dy / (70.0 + 110.0 * rays)) : exp(-(dy * dy) / (22.0 * 22.0));
    float shimmer = 0.82 + 0.18 * sin(p.x * 0.07 - t * 3.2 + fl * 2.0);
    float I = h * rays * shimmer * (0.45 + 0.55 * sstep(-0.2, 0.3, fold));
    I *= 1.0 + 1.8 * pulse + 1.1 * near;
    vec3 cc = mix(uA, uB, clamp(dy / 170.0, 0.0, 1.0));
    cc = mix(cc, uC, clamp(clamp(-dy / 36.0, 0.0, 1.0) * 0.7 + 0.45 * pulse, 0.0, 1.0));
    col += cc * I;
    acc += I;
  }
  col /= max(acc, 1e-3);
  return vec4(col, 0.3 * acc * mix(0.75, 1.0, uLive));
}
`;

/** Iron filings in a magnetic field: a grid of short dashes, each turned
 * along the field of two slow poles. The pointer is a strong spinning pole
 * the filings wrap around; a click is a pulse that spins a ring of filings
 * outward. */
const MAGNETIC = `
vec2 bfield(vec2 x) {
  vec2 P1 = uView * vec2(0.24 + 0.06 * sin(uTime * 0.21), 0.32 + 0.05 * cos(uTime * 0.17));
  vec2 P2 = uView * vec2(0.76 + 0.05 * cos(uTime * 0.19), 0.7 + 0.05 * sin(uTime * 0.23));
  vec2 r1 = x - P1;
  vec2 r2 = x - P2;
  vec2 B = r1 / (dot(r1, r1) + 900.0) - r2 / (dot(r2, r2) + 900.0);
  vec2 rp = x - uPointer.xy;
  float dp2 = dot(rp, rp) + 600.0;
  B += uPointer.z * 2.6 * (vec2(-rp.y, rp.x) * 0.9 + rp * 0.45) / dp2;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    vec2 r = x - c.xy;
    float d = length(r);
    float R = clickFront(c.z, 600.0, 1.4);
    float fr = exp(-sq((d - R) / 46.0)) * clickAmp(c.z);
    B += (vec2(-r.y, r.x) / max(d, 1.0)) * fr * 0.03 + r / (dot(r, r) + 900.0) * clickAmp(c.z) * 3.0;
  }
  return B;
}
vec4 effect(vec2 p) {
  const float CS = 17.0;
  vec2 id = floor(p / CS);
  vec2 jit = (hash22(id) - 0.5) * 4.0;
  vec2 cc = (id + 0.5) * CS + jit;
  vec2 B = bfield(cc);
  float m = length(B) * 260.0;
  vec2 dir = B / max(length(B), 1e-6);
  vec2 local = p - cc;
  float along = dot(local, dir);
  float across = dot(local, vec2(-dir.y, dir.x));
  float L = 3.5 + 3.0 * clamp(m, 0.0, 1.4);
  float sd = length(vec2(max(abs(along) - L, 0.0), across));
  float line = sstep(1.35, 0.25, sd);
  float tw = 0.75 + 0.25 * sin(uTime * 2.6 + hash12(id + 7.0) * 6.283);
  float hotP = pointerGlow(cc, 120.0);
  float ring = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float d = length(cc - c.xy);
    float R = clickFront(c.z, 600.0, 1.4);
    ring += exp(-sq((d - R) / 40.0)) * clickAmp(c.z);
  }
  float strength = clamp(m, 0.0, 1.0);
  float I = line * tw * (0.22 + 0.6 * strength + 0.9 * hotP + 1.1 * ring);
  vec3 color = mix(uB, uA, strength);
  color = mix(color, uC, clamp(hotP * 0.8 + ring, 0.0, 1.0));
  return vec4(color, 0.42 * I * mix(0.7, 1.0, uLive));
}
`;

/** A neon synthwave horizon: a perspective grid that scrolls toward the
 * viewer while the effect runs, a striped sun on the horizon. The camera
 * pans with the pointer and the floor glows under it; a click sends a neon
 * pulse rolling along the grid lines from where it landed. */
const SYNTHWAVE = `
vec2 floorAt(vec2 x, float hz, float cx) {
  float y = max(x.y - hz, 1.0);
  float z = 150.0 / y;
  return vec2((x.x - cx) * z / 150.0 * 3.6, z * 3.6 + uTime * 2.4);
}
vec4 effect(vec2 p) {
  float hz = uView.y * 0.56;
  float cx = uView.x * 0.5 - uDrift.x * uView.x * 0.14;
  vec3 color = uA;
  float a = 0.0;
  float pulseSky = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float d = length(p - c.xy);
    float R = clickFront(c.z, 700.0, 1.5);
    pulseSky += clickAmp(c.z) * exp(-sq((d - R) / 30.0)) * 0.6;
  }
  if (p.y > hz) {
    float y = p.y - hz;
    vec2 g = floorAt(p, hz, cx);
    vec2 fw = max(fwidth(g), vec2(1e-4));
    vec2 dl = abs(fract(g - 0.5) - 0.5) / fw;
    float px = min(dl.x, dl.y);
    float line = 1.0 - sstep(0.0, 1.2, px);
    float glow = exp(-px * 0.28) * 0.45;
    float fade = sstep(0.0, 70.0, y);
    float pulse = 0.0;
    for (int i = 0; i < MAXC; i++) {
      if (i >= uCount) break;
      vec4 c = uClicks[i];
      vec2 cg = floorAt(vec2(c.x, max(c.y, hz + 24.0)), hz, cx);
      float d = length(g - cg);
      float R = c.z * 7.5;
      float x = (d - R) / 0.9;
      pulse += clickAmp(c.z) * exp(-x * x);
    }
    float under = pointerGlow(p, 170.0);
    float I = (line + glow) * fade * (1.0 + 2.2 * under + 3.0 * pulse) + 0.25 * pulse * fade;
    color = mix(uA, uB, sstep(0.0, uView.y * 0.42, y));
    color = mix(color, uC, clamp(pulse * 1.2 + under * 0.4, 0.0, 1.0));
    a = 0.3 * I;
  } else {
    vec2 sc = vec2(cx, hz - uView.y * 0.06);
    float r = uView.y * 0.17;
    float d = length(p - sc);
    float s = (p.y - sc.y) / r;
    float disc = sstep(r, r - 1.5, d);
    float gap = clamp(s, 0.0, 1.0) * 0.6;
    float stripe = s > 0.05 ? step(gap, fract(s * 6.5 + uTime * 0.3)) : 1.0;
    float sun = disc * stripe;
    float halo = exp(-max(d - r, 0.0) / (r * 0.45)) * 0.35 * (1.0 + 1.5 * pointerGlow(sc, r * 2.0));
    float horizon = exp(-(hz - p.y) / 26.0) * 0.6;
    vec2 sid = floor(p / 3.0);
    float star = step(0.9965, hash12(sid)) * (1.0 - sstep(hz * 0.3, hz, p.y)) * (0.5 + 0.5 * sin(uTime * 3.0 + hash12(sid + 2.0) * 20.0));
    vec3 sunCol = mix(uC, uA, clamp(s * 0.5 + 0.5, 0.0, 1.0));
    float I = sun * 0.5 + halo * 0.7 + horizon + star * 0.8 + pulseSky;
    color = (sunCol * (sun * 0.5 + halo * 0.7) + uB * horizon + uC * (star * 0.8 + pulseSky)) / max(I, 1e-3);
    a = 0.3 * I;
  }
  return vec4(color, a * mix(0.75, 1.0, uLive));
}
`;

/** Ink in water: domain-warped smoke drifting slowly. The pointer stirs it
 * (a swirl around the pointer, dragged along its motion); a click drops ink
 * that blooms outward in a curling ring. */
const INK = `
vec4 effect(vec2 p) {
  const float S = 280.0;
  vec2 q = p / S;
  vec2 dp = p - uPointer.xy;
  float g = uPointer.z * exp(-dot(dp, dp) / (180.0 * 180.0));
  vec2 pc = uPointer.xy / S;
  q = pc + rot(g * (1.8 + 2.0 * uPointer.w)) * (q - pc);
  q -= uVel * g * 0.5;
  float drop = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    vec2 r = p - c.xy;
    float d = length(r) + 1e-3;
    float amp = clickAmp(c.z);
    float R = clickFront(c.z, 460.0, 1.3);
    float front = exp(-sq((d - R) / 80.0));
    q -= (r / d) * front * amp * 0.28;
    vec2 cq = c.xy / S;
    q = cq + rot(amp * 1.6 * exp(-d / 260.0)) * (q - cq);
    drop += amp * (front * 0.9 + exp(-d / (50.0 + R * 0.45)) * 0.7);
  }
  float t = uTime * 0.08;
  vec2 w1 = vec2(fbm3(q + vec2(0.0, t)), fbm3(q + vec2(5.2, 1.3) - t));
  vec2 w2 = vec2(fbm3(q + 3.0 * w1 + vec2(1.7, 9.2) + t * 1.3), fbm3(q + 3.0 * w1 + vec2(8.3, 2.8) - t));
  float f = fbm(q + 2.6 * w2);
  float density = sstep(0.38, 0.95, f + 0.28 * drop);
  vec3 color = mix(uB, uA, clamp(length(w1) * 0.95, 0.0, 1.0));
  color = mix(color, uC, clamp(w2.x * w2.x * 1.1 + drop * 0.55 + g * 0.3, 0.0, 1.0));
  float a = density * (0.16 + 0.26 * min(drop, 1.2) + 0.12 * g);
  return vec4(color, a * mix(0.75, 1.0, uLive));
}
`;

/** Soap bubbles: rising lenses with an iridescent film, a bright rim and a
 * highlight. The pointer pushes them aside like a hand in the water; a click
 * pops the bubbles its ring crosses and releases a burst of small new ones. */
const BUBBLES = `
float bubbleRing(vec2 d, float R) {
  float r = length(d);
  float rim = sstep(1.6, 0.0, abs(r - R));
  float film = sstep(R, R * 0.15, r) * pow(clamp(r / R, 0.0, 1.0), 3.0);
  vec2 l = d + vec2(R * 0.38, R * 0.38);
  float spec = exp(-dot(l, l) / (R * R * 0.025));
  return rim * 0.9 + film * 0.45 + spec * 0.8 * step(r, R);
}
vec4 effect(vec2 p) {
  const float CS = 120.0;
  vec2 dp = p - uPointer.xy;
  float pd = length(dp) + 1e-3;
  vec2 pp = p - (dp / pd) * uPointer.z * 52.0 * exp(-pd * pd / (160.0 * 160.0));
  float coli = floor(pp.x / CS);
  float speed = 12.0 + 16.0 * hash12(vec2(coli, 2.0));
  vec2 q = vec2(pp.x, pp.y + uTime * speed);
  vec2 id = floor(q / CS);
  vec2 f = q - id * CS;
  vec2 h = hash22(id + 5.0);
  float present = step(0.3, hash12(id * 1.3 + 2.0));
  float R = 13.0 + 27.0 * h.x;
  float room = CS * 0.5 - R - 5.0;
  vec2 c = vec2(CS * 0.5) + (h - 0.5) * 2.0 * room;
  c.x += sin(uTime * 1.3 + h.y * 6.283) * min(4.0, room);
  vec2 d = f - c;
  vec2 center = id * CS + c - vec2(0.0, uTime * speed);
  float popped = 0.0;
  float flash = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 k = uClicks[i];
    float dist = length(center - k.xy);
    float Rf = clickFront(k.z, 520.0, 1.6);
    float passed = sstep(Rf - 6.0, Rf - 40.0, dist);
    popped = max(popped, passed * (1.0 - sstep(1.4, CLICK_LIFE, k.z)));
    flash += clickAmp(k.z) * exp(-sq((dist - Rf) / 24.0));
  }
  float body = present * bubbleRing(d, R);
  float spread = R + 10.0 * clamp(flash, 0.0, 1.0);
  float burst = present * flash * sstep(2.0, 0.0, abs(length(d) - spread)) * step(0.0, sin(atan(d.y, d.x) * 10.0));
  float I = body * (1.0 - popped) + burst;
  float ang = atan(d.y, d.x);
  vec3 color = mix(uA, uB, 0.5 + 0.5 * sin(ang * 2.0 + uTime * 1.2 + h.x * 6.0 + length(d) * 0.08));
  float spark = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 k = uClicks[i];
    if (length(p - k.xy) > 420.0) continue;
    for (int j = 0; j < 7; j++) {
      vec2 hk = hash22(vec2(float(j) * 3.7, k.w * 11.0));
      vec2 pos = k.xy + vec2((hk.x - 0.5) * 140.0 * sqrt(k.z), -k.z * (50.0 + 110.0 * hk.y));
      pos.x += sin(k.z * 3.0 + hk.y * 6.283) * 6.0;
      float rr = 4.0 + 9.0 * hk.x;
      spark += bubbleRing(p - pos, rr) * (1.0 - sstep(1.6, CLICK_LIFE, k.z)) * sstep(0.0, 0.15, k.z);
    }
  }
  I += spark;
  color = mix(color, uC, clamp(burst + spark * 0.4 + pointerGlow(p, 120.0) * 0.3, 0.0, 1.0));
  return vec4(color, 0.34 * I * mix(0.75, 1.0, uLive));
}
`;

/** A living constellation: drifting points joined to their neighbours. The
 * pointer draws the nearby points toward it and links them to itself; a
 * click sends a pulse of light along the links. */
const CONSTELLATION = `
const float CSZ = 84.0;
vec2 starAt(vec2 id) {
  vec2 h = hash22(id);
  float ph = h.x * 6.283;
  vec2 pos = (id + 0.5 + 0.3 * vec2(cos(uTime * 0.3 * (0.5 + h.y) + ph), sin(uTime * 0.26 * (0.5 + h.x) + ph * 1.3))) * CSZ;
  vec2 r = uPointer.xy - pos;
  float d = length(r);
  pos += r * uPointer.z * 0.22 * exp(-d * d / (190.0 * 190.0));
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    vec2 rc = pos - c.xy;
    float dc = length(rc) + 1e-3;
    float R = clickFront(c.z, 640.0, 1.5);
    pos += (rc / dc) * clickAmp(c.z) * 16.0 * exp(-sq((dc - R) / 60.0));
  }
  return pos;
}
float frontAt(vec2 x) {
  float f = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float R = clickFront(c.z, 640.0, 1.5);
    f += clickAmp(c.z) * exp(-sq((length(x - c.xy) - R) / 46.0));
  }
  return f;
}
vec4 effect(vec2 p) {
  vec2 id = floor(p / CSZ);
  // the points of cells -1..2 around this one, computed once
  vec2 pts[16];
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) pts[j * 4 + i] = starAt(id + vec2(float(i - 1), float(j - 1)));
  }
  float links = 0.0;
  float points = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      int ia = (j + 1) * 4 + (i + 1);
      vec2 a = id + vec2(float(i), float(j));
      vec2 pa = pts[ia];
      vec2 dd = p - pa;
      float r2 = dot(dd, dd);
      float size = 1.4 + 1.6 * hash12(a + 9.0);
      points += exp(-r2 / (size * size)) + 0.18 * exp(-r2 / (36.0 * size));
      for (int k = 0; k < 3; k++) {
        int ib = k == 0 ? ia + 1 : k == 1 ? ia + 4 : ia + 5;
        vec2 pb = pts[ib];
        float len = length(pb - pa);
        float w = sstep(CSZ * 1.45, CSZ * 0.7, len);
        if (w <= 0.0) continue;
        float sd = segDist(p, pa, pb);
        links += w * exp(-sd * sd / 0.9);
      }
    }
  }
  float tether = 0.0;
  float dpp = length(p - uPointer.xy);
  if (uPointer.z > 0.01 && dpp < 200.0) {
    vec2 pid = floor(uPointer.xy / CSZ);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 pa = starAt(pid + vec2(float(i), float(j)));
        float len = length(pa - uPointer.xy);
        float w = sstep(170.0, 60.0, len);
        if (w <= 0.0) continue;
        float sd = segDist(p, uPointer.xy, pa);
        tether += w * exp(-sd * sd / 0.8);
      }
    }
    tether *= uPointer.z;
  }
  float front = frontAt(p);
  float near = pointerGlow(p, 160.0);
  float I = links * (0.3 + 1.4 * front + 0.6 * near) + points * (0.7 + 1.6 * front + 0.8 * near) + tether * 0.9;
  vec3 color = mix(uB, uA, clamp(points * 1.2 + near, 0.0, 1.0));
  color = mix(color, uC, clamp(front * 1.3 + tether * 0.5, 0.0, 1.0));
  return vec4(color, 0.4 * I * mix(0.75, 1.0, uLive));
}
`;

/** Sonar over a contour map: the terrain stays almost invisible until it is
 * sounded. The pointer is a small emitter (a lamp and short pings); a click
 * is a full ping, a sharp ring that lights the contours it passes, leaves
 * them glowing, and flashes the contacts hidden on the map. */
const SONAR = `
vec4 effect(vec2 p) {
  float h = fbm(p * 0.0042 + vec2(3.1, 7.7));
  float v = h * 11.0;
  float fw = max(fwidth(v), 1e-4);
  float fv = fract(v);
  float dl = min(fv, 1.0 - fv) / fw;
  float iso = 1.0 - sstep(0.4, 1.4, dl);
  float major = step(2.5, mod(floor(v + 0.5), 3.0)) * 0.6 + 1.0;
  float reveal = 0.1;
  float lamp = pointerGlow(p, 150.0);
  float dpp = length(p - uPointer.xy);
  float kp = fract(uTime * 0.7 - dpp / 240.0);
  float pings = uPointer.z * sstep(0.86, 0.995, kp) * exp(-dpp / 170.0);
  reveal += 0.75 * lamp + 0.6 * pings;
  float ringI = 0.0;
  float blips = 0.0;
  const float BC = 128.0;
  vec2 bid = floor(p / BC);
  vec2 bh = hash22(bid + 4.0);
  float isBlip = step(0.68, hash12(bid * 2.3 + 1.0));
  vec2 bpos = (bid + 0.25 + 0.5 * bh) * BC;
  float db = length(p - bpos);
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float d = length(p - c.xy);
    float R = c.z * 420.0;
    float amp = clickAmp(c.z);
    float behind = d < R ? exp(-(R - d) / 200.0) : 0.0;
    reveal += amp * behind * 1.3;
    ringI += amp * (exp(-sq((d - R) / 10.0)) + 0.35 * exp(-sq((d - R) / 46.0)));
    float since = c.z - length(bpos - c.xy) / 420.0;
    if (since > 0.0) {
      float fl = exp(-since * 1.1) * sstep(0.0, 0.04, since) * (1.0 - sstep(CLICK_LIFE - 0.6, CLICK_LIFE, c.z));
      blips += isBlip * fl * (exp(-db * db / 9.0) * 1.6 + exp(-sq(db - 9.0 - since * 10.0) / 1.6) * 0.8);
    }
  }
  float I = iso * major * reveal + ringI * 0.8 + blips;
  vec3 color = mix(uA, uB, clamp(ringI, 0.0, 1.0));
  color = mix(color, uC, clamp(blips, 0.0, 1.0));
  return vec4(color, 0.5 * I * mix(0.75, 1.0, uLive));
}
`;

/** Fireflies: soft lights wandering and blinking at their own rhythm. They
 * gather and circle around the pointer; a click scatters them and makes all
 * the ones its ring crosses flash together. */
const FIREFLIES = `
const float FCS = 120.0;
vec2 flyAt(vec2 id, out float seed) {
  vec2 h = hash22(id * 1.7 + 3.0);
  seed = h.x;
  vec2 pos = (id + 0.5) * FCS + (h - 0.5) * 30.0;
  float t = uTime * 0.32;
  vec2 wander = vec2(vnoise(vec2(t + h.x * 20.0, h.y * 30.0)), vnoise(vec2(h.x * 40.0, t * 1.1 + h.y * 20.0))) - 0.5;
  pos += wander * 48.0;
  vec2 r = uPointer.xy - pos;
  float d = length(r) + 1e-3;
  float pull = uPointer.z * exp(-d * d / (230.0 * 230.0)) * min(1.0, 140.0 / d);
  vec2 move = r * pull * 0.42 + vec2(-r.y, r.x) / d * pull * 26.0 * sin(uTime * 1.3 + h.y * 6.283);
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    vec2 rc = pos - c.xy;
    float dc = length(rc) + 1e-3;
    move += rc / dc * clickAmp(c.z) * 60.0 * exp(-dc / 240.0);
  }
  // bounded, so the 3x3 cells around a pixel hold every fly that lights it
  float ml = length(move);
  return pos + (ml > 30.0 ? move * (30.0 / ml) : move);
}
vec4 effect(vec2 p) {
  vec2 id = floor(p / FCS);
  float lum = 0.0;
  float hot = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cid = id + vec2(float(i), float(j));
      float seed;
      vec2 pos = flyAt(cid, seed);
      vec2 dd = p - pos;
      float r2 = dot(dd, dd);
      if (r2 > 3600.0) continue;
      float blink = pow(0.5 + 0.5 * sin(uTime * (1.0 + seed * 1.6) * 2.0 + seed * 40.0), 5.0);
      float flash = 0.0;
      for (int k = 0; k < MAXC; k++) {
        if (k >= uCount) break;
        vec4 c = uClicks[k];
        float R = clickFront(c.z, 560.0, 1.6);
        flash += clickAmp(c.z) * exp(-sq((length(pos - c.xy) - R) / 70.0));
      }
      float glow = exp(-r2 / (3.2 * 3.2)) + 0.55 * exp(-r2 / (13.0 * 13.0)) + 0.1 * exp(-sqrt(r2) / 22.0);
      float e = glow * (0.18 + 0.82 * blink + 1.6 * flash);
      lum += e;
      hot += e * clamp(flash + blink * 0.4, 0.0, 1.0);
    }
  }
  float haze = pointerGlow(p, 130.0) * 0.08;
  vec3 color = mix(uA, uC, clamp(hot / max(lum, 1e-3), 0.0, 1.0));
  color = (color * lum + uB * haze) / max(lum + haze, 1e-3);
  return vec4(color, 0.55 * (lum + haze) * mix(0.75, 1.0, uLive));
}
`;

/** A hexagonal crystal: a honeycomb of faceted cells, each a low pyramid of
 * six facets catching the light. The pointer is the light: the cells near it
 * turn their facets to it and glow; a click runs a crystalline wave out cell
 * by cell, the edges flaring as it passes and an afterglow behind. */
const CRYSTAL = `
vec4 hexCell(vec2 x) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(x, x - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(x - hc.xy * s, x - (hc.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hc.xy) : vec4(h.zw, hc.zw + 0.5);
}
vec4 effect(vec2 p) {
  const float HS = 30.0;
  vec4 hx = hexCell(p / HS);
  vec2 h = hx.xy;
  vec2 hid = hx.zw;
  vec2 center = hid * vec2(1.0, 1.7320508) * HS;
  vec2 ah = abs(h);
  float edge = 0.5 - max(dot(ah, vec2(0.5, 0.8660254)), ah.x);
  float edgeLine = 1.0 - sstep(0.0, 1.3 / HS, edge);
  float facet = floor((atan(h.y, h.x) + PI) / (PI / 3.0));
  float fa = (facet + 0.5) * (PI / 3.0) - PI;
  vec2 fn = vec2(cos(fa), sin(fa));
  vec2 tilt = (hash22(hid * 1.3) - 0.5) * 0.8;
  vec2 lightDir = normalize(vec2(-0.6, -0.8));
  float near = pointerGlow(center, 150.0);
  if (uPointer.z > 0.01) lightDir = normalize(mix(lightDir, normalize(uPointer.xy - center + 1e-3), clamp(near * 3.0, 0.0, 1.0)));
  float shade = clamp(0.5 + 0.5 * dot(normalize(fn + tilt), lightDir), 0.0, 1.0);
  float depth = sstep(0.0, 0.5, edge);
  float band = 0.0;
  float after = 0.0;
  for (int i = 0; i < MAXC; i++) {
    if (i >= uCount) break;
    vec4 c = uClicks[i];
    float dc = length(center - c.xy);
    float R = clickFront(c.z, 600.0, 1.5);
    float amp = clickAmp(c.z);
    band += amp * exp(-sq((dc - R) / 34.0));
    after += amp * (dc < R ? exp(-(R - dc) / 110.0) : 0.0) * 0.45;
  }
  float sparkle = step(0.82, hash12(hid + floor(uTime * 6.0))) * band;
  float star = sparkle * exp(-length(h) * 18.0) * 2.0;
  float lit = near + band + after;
  float I = edgeLine * (0.28 + 1.4 * lit) + shade * shade * depth * (0.05 + 0.75 * lit) + star;
  vec3 color = mix(uB, uA, shade);
  color = mix(color, uC, clamp(band * 1.2 + star + near * 0.3, 0.0, 1.0));
  return vec4(color, 0.4 * I * mix(0.75, 1.0, uLive));
}
`;

export const SHADER_SOURCES: Partial<Record<BackgroundEffectId, string>> = {
  matrix: MATRIX,
  starfield: STARFIELD,
  aurora: AURORA,
  magnetic: MAGNETIC,
  synthwave: SYNTHWAVE,
  ink: INK,
  bubbles: BUBBLES,
  constellation: CONSTELLATION,
  sonar: SONAR,
  fireflies: FIREFLIES,
  crystal: CRYSTAL,
};

/** How much a live click speeds the effect's clock up (the starfield's warp,
 * the rain's rush). 0: clicks never touch the clock. */
export const CLICK_BOOST: Partial<Record<BackgroundEffectId, number>> = {
  starfield: 7,
  matrix: 1.6,
  synthwave: 3,
  aurora: 1.2,
  ink: 1.5,
};

/** The full fragment shader of an effect, or null for a non-shader effect. */
export function fragmentShader(id: BackgroundEffectId): string | null {
  const body = SHADER_SOURCES[id];
  return body ? `${PRELUDE}${body}${FOOTER}` : null;
}
