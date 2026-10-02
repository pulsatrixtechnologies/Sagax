// Bunbu's drawing, in a 0..100 box: our own collectible-vinyl little monster
// (src/components/BunbuMascot.tsx). Original art made for Sagax: a single
// gumdrop body (head and body in one piece, no face plate), two long upright
// paddle ears, a curl of fur on top, big round eyes with two highlights, a
// small grin with five little pointy teeth, a heart on the tummy and chunky
// arms and feet. Every part is its own path so a skin paints each one and
// the ears and arms move on their own (the signature ear flop, the wave).
//
// Kept apart from the component so tests and the app icon read the geometry.

export const BUNBU_ART = {
  /** Head and body in one gumdrop, with two round feet at the bottom. */
  body:
    "M50 29C68.5 29 80.5 41.5 81 59C81.5 73 79.5 83.5 73.5 89.5C70.5 94 66.5 96 61.5 96C57.5 96 55 94.2 53.2 92.2C51.2 93.2 48.8 93.2 46.8 92.2C45 94.2 42.5 96 38.5 96C33.5 96 29.5 94 26.5 89.5C20.5 83.5 18.5 73 19 59C19.5 41.5 31.5 29 50 29Z",
  /** The ears, tall rounded paddles leaning a little outward; their base hides behind the head. */
  earLeft: "M34 42C28.5 31 24 15 27.5 7.5C30.5 2 38 2.5 40.5 9C43.5 17.5 45 30 45 40Z",
  earRight: "M66 42C71.5 31 76 15 72.5 7.5C69.5 2 62 2.5 59.5 9C56.5 17.5 55 30 55 40Z",
  /** The inside of each ear (a softer tint). */
  innerLeft: "M35.5 35C31.5 27 29.2 16 31 10.5C32.5 7.5 36 7.8 37.4 11.5C39.5 18 40.6 27 40.8 33Z",
  innerRight: "M64.5 35C68.5 27 70.8 16 69 10.5C67.5 7.5 64 7.8 62.6 11.5C60.5 18 59.4 27 59.2 33Z",
  /** Where each ear pivots (its base, in the box's units). */
  earPivot: { left: [39, 38] as const, right: [61, 38] as const },
  /** Chunky arms, a little oval each side; they pivot at the shoulder. */
  armLeft: { cx: 20.5, cy: 67, rx: 6, ry: 9.5, rotate: 22, pivot: [24, 60] as const },
  armRight: { cx: 79.5, cy: 67, rx: 6, ry: 9.5, rotate: -22, pivot: [76, 60] as const },
  /** The curl of fur on top. */
  tuft: "M47.5 31C46 26 50.5 23.5 53 26.2C54.6 28.2 52.4 30.4 50.6 29",
  /** The eyes: centers and radii; the highlight sits up and to the left. */
  eyes: { left: [39, 51] as const, right: [61, 51] as const, rx: 6.2, ry: 7 },
  /** A small rounded nose. */
  nose: "M47.6 56.4Q50 55.4 52.4 56.4Q51.2 59.4 50 59.4Q48.8 59.4 47.6 56.4Z",
  /** The grin: open, wide, with five teeth along the upper lip. */
  mouth: "M39.5 61.2Q50 64.6 60.5 61.2Q58.8 70.6 50 71Q41.2 70.6 39.5 61.2Z",
  /** The happy grin, bigger. */
  mouthWide: "M37 60.6Q50 65 63 60.6Q61 73 50 73.4Q39 73 37 60.6Z",
  /** The tongue at the bottom of the grin. */
  tongue: { cx: 50, cy: 69.2, rx: 4.2, ry: 1.7 },
  /** Five small pointy teeth: x of each tooth, on the upper lip. */
  teeth: [42.2, 46.1, 50, 53.9, 57.8] as const,
  /** Cheeks. */
  cheeks: { left: [29.5, 60] as const, right: [70.5, 60] as const, rx: 4, ry: 2.4 },
  /** The heart on the tummy. */
  heart: "M50 88.5C40.5 82.6 40.2 74.4 45.6 74.2C48 74.1 49.4 75.8 50 77.3C50.6 75.8 52 74.1 54.4 74.2C59.8 74.4 59.5 82.6 50 88.5Z",
} as const;

/** The upper lip's height at x (the teeth hang from it). */
export function bunbuLipY(x: number, wide = false): number {
  // the quadratic from (x0, y0) through the control (50, yc) to (x1, y0), solved for x
  const [x0, y0, yc] = wide ? [37, 60.6, 65] : [39.5, 61.2, 64.6];
  const t = (x - x0) / (2 * (50 - x0));
  return (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * yc + t * t * y0;
}

/** Every outline at once: the silhouette (glows, auras and the app icon's cut). */
export const BUNBU_SILHOUETTE = `${BUNBU_ART.earLeft} ${BUNBU_ART.earRight} ${BUNBU_ART.body}`;
