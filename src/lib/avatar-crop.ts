// The crop of a person's own photo (Settings > General > Account on an
// organization server, 2026-10-16), the same geometry as the Perspicax
// console's avatar field: a square stage, a circle the photo covers, drag to
// move, a zoom from 1 to 3; the part under the circle becomes a 256 px
// square, a PNG when it fits in 256 KiB, else a JPEG at decreasing quality.

export const AVATAR_SIDE = 256;
export const AVATAR_MAX_BYTES = 256 * 1024;
export const CROP_STAGE = 240;
export const CROP_CIRCLE = 200;
export const CROP_INSET = (CROP_STAGE - CROP_CIRCLE) / 2;
export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 3;
/** What the picker offers; the browser decodes it, the server only gets PNG or JPEG. */
export const CROP_ACCEPT = "image/png,image/jpeg,image/webp";

export interface CropView {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CropLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the photo sits on the stage: scaled to cover the circle, times the
 * zoom, centred, then moved by the pan. */
export function cropLayout(naturalWidth: number, naturalHeight: number, zoom: number, panX: number, panY: number): CropLayout {
  const nw = naturalWidth || CROP_CIRCLE;
  const nh = naturalHeight || CROP_CIRCLE;
  const scale = (CROP_CIRCLE / Math.min(nw, nh)) * zoom;
  const width = nw * scale;
  const height = nh * scale;
  return {
    left: CROP_INSET + (CROP_CIRCLE - width) / 2 + panX,
    top: CROP_INSET + (CROP_CIRCLE - height) / 2 + panY,
    width,
    height,
  };
}

/** The pan kept so the photo always covers the circle (no empty edge). */
export function clampPan(naturalWidth: number, naturalHeight: number, zoom: number, panX: number, panY: number): { x: number; y: number } {
  const { width, height } = cropLayout(naturalWidth, naturalHeight, zoom, 0, 0);
  const maxX = Math.max(0, (width - CROP_CIRCLE) / 2);
  const maxY = Math.max(0, (height - CROP_CIRCLE) / 2);
  // `|| 0`: no -0 when there is no room to move
  return { x: Math.min(maxX, Math.max(-maxX, panX)) || 0, y: Math.min(maxY, Math.max(-maxY, panY)) || 0 };
}

/** The source rectangle under the circle, in the photo's own pixels. */
export function cropView(naturalWidth: number, naturalHeight: number, zoom: number, panX: number, panY: number): CropView {
  const nw = naturalWidth;
  const nh = naturalHeight;
  const scale = (CROP_CIRCLE / Math.min(nw, nh)) * zoom;
  const layout = cropLayout(nw, nh, zoom, panX, panY);
  const side = CROP_CIRCLE / scale;
  const sx = Math.min(Math.max(0, (CROP_INSET - layout.left) / scale), Math.max(0, nw - side));
  const sy = Math.min(Math.max(0, (CROP_INSET - layout.top) / scale), Math.max(0, nh - side));
  return { sx, sy, sw: Math.min(side, nw), sh: Math.min(side, nh) };
}

/** Draw the view into a 256 px square and encode it under the limit. */
export async function encodeAvatar(source: CanvasImageSource, view: CropView): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIDE;
  canvas.height = AVATAR_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, view.sx, view.sy, view.sw, view.sh, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const png = await encode("image/png");
  if (png && png.size <= AVATAR_MAX_BYTES) return png;
  for (const quality of [0.9, 0.8, 0.7, 0.6]) {
    const jpeg = await encode("image/jpeg", quality);
    if (jpeg && jpeg.size <= AVATAR_MAX_BYTES) return jpeg;
  }
  throw new Error("image too large");
}
