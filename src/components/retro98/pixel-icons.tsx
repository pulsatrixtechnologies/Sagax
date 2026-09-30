// Small 16x16 toolbar icons, drawn here as pixel maps (original art, in the
// spirit of late-90s toolbars). Each row is 16 characters; a letter picks a
// colour from PALETTE and a space stays transparent. Runs of one colour
// become a single rect, so an icon is a handful of nodes.

const PALETTE: Record<string, string> = {
  k: "#000000",
  w: "#ffffff",
  g: "#808080",
  s: "#c0c0c0",
  n: "#000080",
  b: "#1084d0",
  c: "#9ad0ff",
  y: "#ffff00",
  o: "#e0a000",
  r: "#c00000",
  e: "#ffffe1",
  m: "#6b4a2b",
};

const ICONS = {
  newBot: [
    "  kkkkkkkk      ",
    "  kwwwwwwkk  y  ",
    "  kwwwwwwkwk yoy",
    "  kwwwwwwkkkk y ",
    "  kwwmmmwwwwk   ",
    "  kwmwwwmwwwk   ",
    "  kwmkwkmwwwk   ",
    "  kwmwowmwwwk   ",
    "  kwwmmmwwwwk   ",
    "  kwwwwwwwwwk   ",
    "  kwwggggwwwk   ",
    "  kwwwwwwwwwk   ",
    "  kwwggggggwk   ",
    "  kwwwwwwwwwk   ",
    "  kkkkkkkkkkk   ",
    "                ",
  ],
  search: [
    "                ",
    "    kkkk        ",
    "  kkccwwkk      ",
    "  kcwwccckk     ",
    " kcwwccccck     ",
    " kcwccccccck    ",
    " kccccccccck    ",
    " kcccccccccg    ",
    "  kccccccckg    ",
    "  kkccccckkg    ",
    "    kkkkkkkgg   ",
    "          kkkg  ",
    "           kkkg ",
    "            kkkg",
    "             kk ",
    "                ",
  ],
  share: [
    "                ",
    "                ",
    "           k    ",
    "           kk   ",
    " kkkkkkkkkkkok  ",
    " keeeeeeekkooyk ",
    " kkeeeeekekkok  ",
    " kekeeekeeekk   ",
    " keekekeeeekk   ",
    " keeekeeeeeek   ",
    " keeeerreeeek   ",
    " keeeerreeeek   ",
    " kkkkkkkkkkkk   ",
    "  gggggggggggg  ",
    "                ",
    "                ",
  ],
  bug: [
    "                ",
    "   k        k   ",
    "    k  kk  k    ",
    "     kkkkkk     ",
    "     krrrrk     ",
    " k  krrkkrrk  k ",
    "  kkrrrkkrrrkk  ",
    "    krrkkrrrk   ",
    " kkkrrrkkrrrkkk ",
    "    krrrkkrrk   ",
    "  kkrrkkkkrrkk  ",
    " k  krrkkrrrk  k",
    "     krrkkrk    ",
    "      kkkkk     ",
    "                ",
    "                ",
  ],
  panel: [
    "                ",
    " kkkkkkkkkkkkkk ",
    " knnnnnnnnnnnnk ",
    " knwnnnnnnnswsk ",
    " kkkkkkkkkkkkkk ",
    " kwwwwwwwkssssk ",
    " kwggggwwksggsk ",
    " kwwwwwwwkssssk ",
    " kwgggwwwksggsk ",
    " kwwwwwwwkssssk ",
    " kwggggwwksggsk ",
    " kwwwwwwwkssssk ",
    " kwwwwwwwkssssk ",
    " kkkkkkkkkkkkkk ",
    "                ",
    "                ",
  ],
  settings: [
    "                ",
    " kkkkkkkkkkkkkk ",
    " knnnnnnnnnnnnk ",
    " kkkkkkkkkkkkkk ",
    " kssssssssssssk ",
    " kskkkksggggssk ",
    " kskwwkssssssk  ",
    " kskkkksggggssk ",
    " kssssssssssssk ",
    " kskkkksggggssk ",
    " kskwkwssssssk  ",
    " kskkkksggggssk ",
    " kssssssssssssk ",
    " kkkkkkkkkkkkkk ",
    "                ",
    "                ",
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

function runs(rows: readonly string[]): Array<{ x: number; y: number; w: number; fill: string }> {
  const out: Array<{ x: number; y: number; w: number; fill: string }> = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end += 1;
      const fill = PALETTE[key];
      if (fill) out.push({ x, y, w: end - x, fill });
      x = end;
    }
  });
  return out;
}

export function PixelIcon({ name, scale = 1 }: { name: PixelIconName; scale?: number }) {
  const size = 16 * scale;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {runs(ICONS[name]).map((run) => (
        <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.w} height={1} fill={run.fill} />
      ))}
    </svg>
  );
}

export const PIXEL_ICON_NAMES = Object.keys(ICONS) as PixelIconName[];
