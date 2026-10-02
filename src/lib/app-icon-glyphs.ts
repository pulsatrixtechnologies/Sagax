// Minimal white glyphs for dark app icons: original Sagax artwork (our own
// spark and cube geometry, not another company's mark), drawn as standalone
// SVG so the picker can paint them through the system template. Each sits in
// a 0 0 100 100 box. The white Shape icon is the Shapes circle itself (its
// outline and its eye proportions from shape-art.ts), large and shaded.
import { EYES, SHAPE_ART } from "@/components/shape-art";

export type AppIconGlyph = "shape" | "spark" | "cube";

const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><defs>${defs}</defs>${body}</svg>`;

/**
 * The Shapes circle as a big glossy sphere rising from the bottom right,
 * cropped by the tile, its two eyes long dark capsules leaning together,
 * on a near-black diagonal ground. Fills the whole body (fit "cover").
 */
function shape(): string {
  const { d } = SHAPE_ART.circle;
  // the circle is r 42 around (50, 50): about r 77 around (71, 90), so its
  // edge runs from the left side up to the top right and the dark ground
  // stays in the top-left region
  const scale = 77 / 42;
  const cx = 71;
  const cy = 90;
  // the Shapes eyes' proportions (about 1 : 2.2), large enough to read
  const eyeW = EYES.rx * 2.6;
  const eyeH = EYES.ry * 2.9;
  const eye = (x: number, y: number) =>
    `<rect x="${x - eyeW / 2}" y="${y - eyeH / 2}" width="${eyeW}" height="${eyeH}" rx="${eyeW / 2}" fill="#0B0B0D" transform="rotate(-20 ${x} ${y})"/>`;
  return svg(
    `<rect width="100" height="100" fill="url(#bg)"/>` +
      `<path d="${d}" fill="url(#ball)" transform="translate(${cx - 50 * scale} ${cy - 50 * scale}) scale(${scale})"/>` +
      eye(47, 56) +
      eye(73, 43),
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.35"><stop offset="0" stop-color="#121214"/><stop offset="1" stop-color="#2F2F33"/></linearGradient>` +
      `<radialGradient id="ball" cx="0.32" cy="0.26" r="0.6"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.35" stop-color="#F1F1F3"/><stop offset="0.75" stop-color="#CFCFD4"/><stop offset="1" stop-color="#9E9EA5"/></radialGradient>`,
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
