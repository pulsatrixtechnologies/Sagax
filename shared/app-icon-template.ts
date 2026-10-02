// The system template a custom app icon is drawn through, so a picture the
// person picks sits in the Dock (or the taskbar) like every other app's icon.
// Pure geometry: the renderer (src/lib/app-icon.ts) paints with it on a
// canvas, the desktop app (electron/app-icon.mjs) only stores and applies
// the result.
//
// macOS (Big Sur and later, Tahoe included): Apple's app icon grid is a
// 1024 x 1024 canvas with an 824 x 824 body centred on it (a 100 px margin
// on every side), its corners a continuous curve ("squircle", not a circular
// arc) of radius 185.4, and a soft drop shadow below the body inside the
// margin. Icons drawn on that grid line up with the system's own.
//
// Windows: the window and taskbar icon is the whole square (no margin; the
// taskbar adds its own), with the gently rounded corners of Windows 11's
// Fluent icons, written as an .ico holding every size the shell asks for.

export type AppIconPlatform = "macos" | "windows" | "linux";

export type AppIconTemplate = {
  platform: AppIconPlatform;
  /** The square canvas the master image is drawn on, in pixels. */
  canvas: number;
  /** The body's left and top edge on that canvas. */
  inset: number;
  /** The body's width and height. */
  body: number;
  /** The continuous corner's radius, in canvas pixels. */
  radius: number;
  /** The drop shadow under the body (none on Windows: the shell draws it). */
  shadow: { color: string; blur: number; offsetY: number } | null;
  /** The pixel sizes written out (macOS: the master only; the Dock scales it). */
  sizes: readonly number[];
};

export const APP_ICON_TEMPLATES: Readonly<Record<AppIconPlatform, AppIconTemplate>> = {
  macos: {
    platform: "macos",
    canvas: 1024,
    inset: 100,
    body: 824,
    radius: 185.4,
    shadow: { color: "rgba(0, 0, 0, 0.3)", blur: 20, offsetY: 10 },
    sizes: [1024],
  },
  windows: {
    platform: "windows",
    canvas: 256,
    inset: 0,
    body: 256,
    radius: 36,
    shadow: null,
    sizes: [16, 20, 24, 32, 40, 48, 64, 256],
  },
  linux: {
    platform: "linux",
    canvas: 512,
    inset: 16,
    body: 480,
    radius: 96,
    shadow: { color: "rgba(0, 0, 0, 0.25)", blur: 10, offsetY: 4 },
    sizes: [512],
  },
};

/** The template for a Node/Electron `process.platform` value. */
export function appIconPlatform(platform: string): AppIconPlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

export type PathSegment =
  | { op: "M" | "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

// The continuous corner, as the iOS 7 / macOS 11 rounded rectangle draws
// it: the straight edge stops 1.528665 radii before the corner and three
// cubic curves ease into the turn, so the curvature has no step where an arc
// would meet the line. Values are fractions of the radius.
const K = {
  edge: 1.52866483,
  c1: 1.08849296,
  c2: 0.86840694,
  p1x: 0.63149379,
  p1y: 0.07491139,
  c3: 0.37282383,
  c4: 0.16905956,
  c5: 0.02247361,
} as const;

/** The squircle outline of a w x h box at (x, y), clockwise from the top edge. */
export function continuousRectPath(x: number, y: number, w: number, h: number, radius: number): PathSegment[] {
  // A radius too large for the box would make the edges cross.
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2 / K.edge));
  const right = x + w;
  const bottom = y + h;
  // One corner in local coordinates: u runs along the incoming edge toward
  // the corner, v along the outgoing edge away from it.
  const corner = (map: (u: number, v: number) => [number, number]): PathSegment[] => {
    const c = (u1: number, v1: number, u2: number, v2: number, u: number, v: number): PathSegment => {
      const [x1, y1] = map(u1, v1);
      const [x2, y2] = map(u2, v2);
      const [px, py] = map(u, v);
      return { op: "C", x1, y1, x2, y2, x: px, y: py };
    };
    return [
      c(K.c1 * r, 0, K.c2 * r, K.c5 * r, K.p1x * r, K.p1y * r),
      c(K.c3 * r, K.c4 * r, K.c4 * r, K.c3 * r, K.p1y * r, K.p1x * r),
      c(K.c5 * r, K.c2 * r, 0, K.c1 * r, 0, K.edge * r),
    ];
  };
  const line = (px: number, py: number): PathSegment => ({ op: "L", x: px, y: py });
  return [
    { op: "M", x: x + K.edge * r, y },
    line(right - K.edge * r, y),
    // top right: u = distance left of the right edge, v = distance below the top
    ...corner((u, v) => [right - u, y + v]),
    line(right, bottom - K.edge * r),
    // bottom right: u = distance above the bottom, v = distance left of the right edge
    ...corner((u, v) => [right - v, bottom - u]),
    line(x + K.edge * r, bottom),
    // bottom left
    ...corner((u, v) => [x + u, bottom - v]),
    line(x, y + K.edge * r),
    // top left
    ...corner((u, v) => [x + v, y + u]),
  ];
}

/** The body's outline on its template's canvas, scaled to `size` pixels. */
export function appIconMaskPath(template: AppIconTemplate, size = template.canvas): PathSegment[] {
  const scale = size / template.canvas;
  return continuousRectPath(template.inset * scale, template.inset * scale, template.body * scale, template.body * scale, template.radius * scale);
}

/** The outline as an SVG path `d`. */
export function pathToSvg(path: readonly PathSegment[]): string {
  const n = (value: number) => String(Math.round(value * 1000) / 1000);
  return (
    path
      .map((s) => (s.op === "C" ? `C${n(s.x1)} ${n(s.y1)} ${n(s.x2)} ${n(s.y2)} ${n(s.x)} ${n(s.y)}` : `${s.op}${n(s.x)} ${n(s.y)}`))
      .join("") + "Z"
  );
}

/** The outline flattened to a polygon (for hit tests and checks). */
export function flattenPath(path: readonly PathSegment[], steps = 16): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let cx = 0;
  let cy = 0;
  for (const s of path) {
    if (s.op !== "C") {
      points.push([s.x, s.y]);
      cx = s.x;
      cy = s.y;
      continue;
    }
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t ** 2;
      const d = t ** 3;
      points.push([a * cx + b * s.x1 + c * s.x2 + d * s.x, a * cy + b * s.y1 + c * s.y2 + d * s.y]);
    }
    cx = s.x;
    cy = s.y;
  }
  return points;
}

/** Whether a point lies inside the outline (even-odd). */
export function insideMask(path: readonly PathSegment[], x: number, y: number): boolean {
  const polygon = flattenPath(path);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where the artwork lands inside the body: centred, scaled to fit
 * `fill` of the body (a mascot keeps a margin like Apple's glyph icons; a
 * photo fills the body edge to edge and is cropped by the mask).
 */
export function artworkRect(
  template: AppIconTemplate,
  size: number,
  art: { width: number; height: number },
  fit: "contain" | "cover",
  fill: number = fit === "cover" ? 1 : 0.9,
): { x: number; y: number; width: number; height: number } {
  const scale = size / template.canvas;
  const box = template.body * scale * fill;
  const ratio = fit === "cover" ? Math.max(box / art.width, box / art.height) : Math.min(box / art.width, box / art.height);
  const width = art.width * ratio;
  const height = art.height * ratio;
  const centre = (template.inset + template.body / 2) * scale;
  return { x: centre - width / 2, y: centre - height / 2, width, height };
}
