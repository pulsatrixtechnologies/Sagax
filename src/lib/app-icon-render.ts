// Paints an app icon through the system template on a canvas: the drop
// shadow, the squircle plate with its top-to-bottom gradient, the artwork
// clipped to the plate, a soft light from the top and a hairline edge, the
// way macOS draws its own icons. Browser only (canvas, Image).
import { appIconMaskPath, artworkRect, pathToSvg, type AppIconTemplate } from "../../shared/app-icon-template";

export type IconArt = { image: CanvasImageSource; width: number; height: number };

export function renderAppIcon(
  template: AppIconTemplate,
  size: number,
  art: IconArt | null,
  options: { background: readonly [string, string]; fit: "contain" | "cover" },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const scale = size / template.canvas;
  const mask = new Path2D(pathToSvg(appIconMaskPath(template, size)));
  const top = template.inset * scale;
  const bottom = (template.inset + template.body) * scale;

  if (template.shadow) {
    ctx.save();
    ctx.shadowColor = template.shadow.color;
    ctx.shadowBlur = template.shadow.blur * scale;
    ctx.shadowOffsetY = template.shadow.offsetY * scale;
    ctx.fillStyle = options.background[1];
    ctx.fill(mask);
    ctx.restore();
  }

  ctx.save();
  ctx.clip(mask);
  const plate = ctx.createLinearGradient(0, top, 0, bottom);
  plate.addColorStop(0, options.background[0]);
  plate.addColorStop(1, options.background[1]);
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, size, size);
  if (art) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const rect = artworkRect(template, size, art, options.fit);
    ctx.drawImage(art.image, rect.x, rect.y, rect.width, rect.height);
  }
  // light from above, as on the system's icons
  const sheen = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * 0.55);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.10)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // the hairline edge that keeps a light icon from melting into the Dock
  if (size >= 64) {
    ctx.save();
    ctx.clip(mask);
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.10)";
    ctx.stroke(mask);
    ctx.restore();
  }
  return canvas;
}

/** Load an image from a URL (an SVG or raster served by the app, a blob). */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src.slice(0, 80)}`));
    image.src = src;
  });
}

// The presentation properties a mascot's CSS may set (skins, themes): copied
// onto the clone so the picture outside the page looks like the one inside.
const PAINT = ["fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width", "opacity", "display", "visibility", "stop-color", "stop-opacity", "color"] as const;

/** Draw a live `<svg>` (a mascot on the page) as an image. */
export async function svgElementToArt(svg: SVGSVGElement, size: number): Promise<IconArt> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const source = [svg, ...svg.querySelectorAll("*")];
  const copy = [clone, ...clone.querySelectorAll("*")];
  source.forEach((element, index) => {
    const target = copy[index] as SVGElement | undefined;
    if (!target?.style) return;
    const computed = getComputedStyle(element);
    for (const name of PAINT) {
      const value = computed.getPropertyValue(name);
      if (value) target.style.setProperty(name, value);
    }
    // Freeze any running animation on its current frame.
    target.style.setProperty("animation", "none");
  });
  const box = svg.viewBox?.baseVal;
  const ratio = box && box.width && box.height ? box.width / box.height : 1;
  const width = ratio >= 1 ? size : Math.round(size * ratio);
  const height = ratio >= 1 ? Math.round(size / ratio) : size;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("class");
  clone.style.removeProperty("transform");
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const image = await loadImage(url);
    return { image, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The art drawn inside a container: its `<svg>`, or its `<img>` (a photo avatar). */
export async function elementToArt(root: HTMLElement, size: number): Promise<IconArt | null> {
  const img = root.querySelector("img");
  if (img?.src) {
    const image = await loadImage(img.src);
    return { image, width: image.naturalWidth || size, height: image.naturalHeight || size };
  }
  const svg = root.querySelector("svg");
  return svg ? svgElementToArt(svg, size) : null;
}

/** A picture the person chose, as art (any size; the template crops it). */
export async function fileToArt(file: Blob): Promise<IconArt> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("empty image");
    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
