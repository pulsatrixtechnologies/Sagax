// Minimal white glyphs for dark app icons: original Sagax artwork (our own
// spark and cube geometry, not another company's mark), drawn as standalone
// SVG so the picker can paint them through the system template. Each sits in
// a 0 0 100 100 box. The white Shape icon is the Shapes mascot itself (its
// outline from shape-art.ts, its resting eyes from shape-engine.ts), shaded.
import { SHAPE_ART } from "@/components/shape-art";
import { stillFrame } from "@/components/shape-engine";

export type AppIconGlyph = "shape" | "spark" | "cube";

const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><defs>${defs}</defs>${body}</svg>`;

/**
 * The Shapes mascot, whole and centred: the Shapes circle's own outline in a
 * soft white to light grey, lit from the top left with a shade underneath,
 * and its resting eyes (the neutral face the app draws, two dark capsules
 * leaning a little) on an anthracite plate that is lighter in the middle.
 * JC, 2026-10-14: the first version cropped a big sphere across the tile, so
 * the icon read as a black and white diagonal cut, not as the mascot.
 * Fills the whole body (fit "cover"): the plate is part of the drawing.
 */
function shape(): string {
  const { d } = SHAPE_ART.circle;
  // the neutral face, exactly as ShapeMascot draws it at rest
  const { eyes } = stillFrame({ shape: "circle", expression: "neutral", color: "#FFFFFF" });
  // the circle is r 40 around (50, 50) in the mascot's box; at 0.68 it takes
  // a bit over half the tile, the margin Apple's glyph icons keep
  const place = "translate(50 49) scale(0.68) translate(-50 -50)";
  return svg(
    `<rect width="100" height="100" fill="url(#bg)"/>` +
      // a soft contact shadow under the body
      `<ellipse cx="50" cy="79" rx="21" ry="3.6" fill="#000000" fill-opacity="0.35" filter="url(#blur)"/>` +
      `<g transform="${place}" filter="url(#drop)">` +
      `<path d="${d}" fill="url(#ball)"/>` +
      // the turned-away side, a shade toward the bottom right
      `<path d="${d}" fill="url(#shade)"/>` +
      `<path d="${eyes}" fill="#141417"/>` +
      `</g>`,
    `<radialGradient id="bg" cx="0.5" cy="0.46" r="0.72"><stop offset="0" stop-color="#4B4C52"/><stop offset="0.6" stop-color="#2E2F34"/><stop offset="1" stop-color="#1E1F23"/></radialGradient>` +
      `<radialGradient id="ball" cx="0.36" cy="0.3" r="0.78"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="#F3F4F6"/><stop offset="0.8" stop-color="#DCDDE2"/><stop offset="1" stop-color="#C4C6CC"/></radialGradient>` +
      `<radialGradient id="shade" cx="0.72" cy="0.82" r="0.55"><stop offset="0" stop-color="#8E9099" stop-opacity="0.32"/><stop offset="1" stop-color="#8E9099" stop-opacity="0"/></radialGradient>` +
      `<filter id="blur" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="2"/></filter>` +
      `<filter id="drop" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.8" flood-color="#000000" flood-opacity="0.35"/></filter>`,
  );
}

/** A spark of ten tapered rays, long and short in turn, around a small core. */
function spark(): string {
  const rays: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const long = i % 2 === 0;
    const length = long ? 40 : 25;
    const width = long ? 4.6 : 3.6;
    const angle = i * 36 + 9;
    rays.push(
      `<path d="M50 50 L${50 - width} ${50 - length * 0.42} Q50 ${50 - length - 2} ${50 + width} ${50 - length * 0.42} Z" transform="rotate(${angle} 50 50)"/>`,
    );
  }
  return svg(`<g fill="#FFFFFF">${rays.join("")}<circle cx="50" cy="50" r="7"/></g>`);
}

/** An isometric cube, glossy white to silver, its edges softly rounded. */
function cube(): string {
  const top = "M50 14 L82 32 L50 50 L18 32 Z";
  const left = "M18 32 L50 50 L50 88 L18 70 Z";
  const right = "M82 32 L50 50 L50 88 L82 70 Z";
  return svg(
    `<g stroke-linejoin="round" stroke-width="3">` +
      `<path d="${top}" fill="url(#t)" stroke="#FFFFFF"/>` +
      `<path d="${left}" fill="url(#l)" stroke="#E9ECF2"/>` +
      `<path d="${right}" fill="url(#r)" stroke="#B4BBC7"/>` +
      `<path d="M50 50 L50 88" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="1.2"/>` +
      `</g>`,
    `<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EEF1F6"/></linearGradient>` +
      `<linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E6E9EF"/><stop offset="1" stop-color="#C9CED8"/></linearGradient>` +
      `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#AEB5C2"/><stop offset="1" stop-color="#7F8796"/></linearGradient>`,
  );
}

const GLYPHS: Record<AppIconGlyph, () => string> = { shape, spark, cube };

/** The glyph as SVG markup. */
export function appIconGlyphSvg(glyph: AppIconGlyph): string {
  return GLYPHS[glyph]();
}
