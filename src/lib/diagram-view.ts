// Sizing, pan/zoom and export of a rendered diagram (Mermaid SVG): the
// inline frame in a message (ChatMarkdown.tsx MermaidDiagram) and the full
// window viewer (src/components/DiagramViewer.tsx). Pure functions except
// svgToPng and downloadBlob, which need a browser.

export interface Size { width: number; height: number }
export interface ViewTransform { scale: number; x: number; y: number }

/** Inline diagrams never grow past their natural size and never exceed this
 * share of the window's height. */
export const DIAGRAM_MAX_HEIGHT_RATIO = 0.6;
/** Fallback height cap when the window height is unknown. */
export const DIAGRAM_MAX_HEIGHT_PX = 560;
/** Below this scale the diagram's text is smaller than about 60 % of the
 * app's text: the inline frame offers the full window view (Agrandir). */
export const DIAGRAM_READABLE_SCALE = 0.6;

export const DIAGRAM_ZOOM_MIN = 0.1;
export const DIAGRAM_ZOOM_MAX = 8;

const NUMBER = /^\s*([0-9]*\.?[0-9]+)/;

/** The natural size of an SVG string: its viewBox, else its width and height
 * attributes when they are plain numbers or px. Null when neither is usable. */
export function svgSize(svg: string): Size | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const viewBox = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0) {
      return { width: parts[2]!, height: parts[3]! };
    }
  }
  const attribute = (name: string) => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
    if (!value || /%|em|rem|vw|vh/i.test(value)) return null;
    const match = NUMBER.exec(value);
    return match ? Number(match[1]) : null;
  };
  const width = attribute("width"), height = attribute("height");
  return width && height ? { width, height } : null;
}

export interface InlineDiagramSize extends Size {
  /** Displayed size over natural size, at most 1. */
  scale: number;
  /** The text would read smaller than the readable threshold. */
  cramped: boolean;
}

/** The inline size of a diagram: fit to the column width and under the
 * height cap, keeping its aspect ratio, never upscaled past natural size. */
export function inlineDiagramSize(natural: Size, containerWidth: number, maxHeight: number): InlineDiagramSize {
  const width = Math.max(0, natural.width), height = Math.max(0, natural.height);
  if (!width || !height) return { width: 0, height: 0, scale: 1, cramped: false };
  const byWidth = containerWidth > 0 ? containerWidth / width : 1;
  const byHeight = maxHeight > 0 ? maxHeight / height : 1;
  const scale = Math.min(1, byWidth, byHeight);
  return {
    width: Math.floor(width * scale),
    height: Math.floor(height * scale),
    scale,
    cramped: scale < DIAGRAM_READABLE_SCALE,
  };
}

/** The height cap for an inline diagram in a window of this height. */
export function inlineDiagramMaxHeight(viewportHeight: number | undefined): number {
  return viewportHeight && viewportHeight > 0
    ? Math.max(200, Math.round(viewportHeight * DIAGRAM_MAX_HEIGHT_RATIO))
    : DIAGRAM_MAX_HEIGHT_PX;
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(DIAGRAM_ZOOM_MAX, Math.max(DIAGRAM_ZOOM_MIN, scale));
}

/** The transform that centers the content in the viewport, scaled to fit
 * with a margin (upscaled up to 2x for a small diagram on a large screen). */
export function fitTransform(content: Size, viewport: Size, margin = 24): ViewTransform {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = clampZoom(Math.min(
    2,
    Math.max(1, viewport.width - margin * 2) / content.width,
    Math.max(1, viewport.height - margin * 2) / content.height,
  ));
  return { scale, x: (viewport.width - content.width * scale) / 2, y: (viewport.height - content.height * scale) / 2 };
}

/** Zoom by a factor around a point of the viewport, so that point stays put. */
export function zoomAt(view: ViewTransform, factor: number, point: { x: number; y: number }): ViewTransform {
  const scale = clampZoom(view.scale * factor);
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

/** An SVG file that opens on its own: namespaces, XML declaration, and the
 * natural size as width and height instead of 100 % with a max-width. */
export function standaloneSvg(svg: string): string {
  const size = svgSize(svg);
  const body = svg.replace(/^\s*<\?xml[^>]*>\s*/i, "");
  const fixed = body.replace(/<svg\b([^>]*)>/i, (_whole, attributes: string) => {
    let next = attributes
      .replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\sstyle\s*=\s*["'][^"']*["']/i, "");
    if (!/\sxmlns\s*=/.test(next)) next += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/\sxmlns:xlink\s*=/.test(next) && /xlink:/.test(body)) next += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    if (size) next += ` width="${size.width}" height="${size.height}"`;
    return `<svg${next}>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${fixed}`;
}

/** Mermaid source with a directive that draws every label as SVG text
 * (htmlLabels off). Such an SVG draws on a canvas without tainting it, which
 * the PNG export needs. A front matter block stays first. */
export function exportableMermaidSource(code: string): string {
  const directive = '%%{init: {"htmlLabels": false, "flowchart": {"htmlLabels": false}}}%%';
  const front = /^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(code);
  return front ? `${front[0]}${directive}\n${code.slice(front[0].length)}` : `${directive}\n${code}`;
}

/** A safe file name for an export: no path characters, bounded length. */
export function exportFileName(base: string, extension: string): string {
  const clean = [...base].map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char)).join("").trim().slice(0, 120) || "diagram";
  return `${clean}.${extension}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Rasterize an SVG to PNG at `pixelRatio` times its natural size on a solid
 * background. Rejects when the browser refuses (a tainted canvas). */
export async function svgToPng(svg: string, { pixelRatio = 2, background }: { pixelRatio?: number; background?: string } = {}): Promise<Blob> {
  const size = svgSize(svg);
  if (!size) throw new Error("size");
  const source = standaloneSvg(svg);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image"));
      image.src = url;
    });
    // Canvas sizes above about 16k px fail in Chromium; scale down to stay under.
    const ratio = Math.min(pixelRatio, 16_000 / size.width, 16_000 / size.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas");
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png");
      } catch (error) {
        reject(error instanceof Error ? error : new Error("png"));
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
