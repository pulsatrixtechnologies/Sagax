// Pure helpers of the in-app PDF viewer (src/components/PdfViewer.tsx):
// bounded byte reads, the PDF signature check, zoom steps and the text
// search across pages.

export const PDF_ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export const PDF_ZOOM_MIN = PDF_ZOOM_STEPS[0];
export const PDF_ZOOM_MAX = PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]!;

export function clampPdfZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, scale));
}

/** The next zoom step above (1) or below (-1) the current scale. */
export function pdfZoomStep(current: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  if (direction > 0) return PDF_ZOOM_STEPS.find((step) => step > current + epsilon) ?? PDF_ZOOM_MAX;
  return [...PDF_ZOOM_STEPS].reverse().find((step) => step < current - epsilon) ?? PDF_ZOOM_MIN;
}

/** The scale that fits a page of this width in the viewport (with margins). */
export function pdfFitWidthScale(pageWidth: number, viewportWidth: number, margin = 32): number {
  if (pageWidth <= 0 || viewportWidth <= 0) return 1;
  return clampPdfZoom((viewportWidth - margin) / pageWidth);
}

/** True when the bytes start with the PDF signature (%PDF-, allowing for
 * leading junk within the first kilobyte, as readers do). */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 5, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46 && bytes[index + 4] === 0x2d) return true;
  }
  return false;
}

/** Case, accent and spacing insensitive form for the page search. */
export function searchable(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLocaleLowerCase().replace(/\s+/g, " ");
}

/** The pages (0-based, in order) whose text contains the query, with how
 * many times; an empty query matches nothing. */
export function pdfSearchPages(pageTexts: readonly string[], query: string): { page: number; count: number }[] {
  const needle = searchable(query).trim();
  if (!needle) return [];
  const out: { page: number; count: number }[] = [];
  pageTexts.forEach((text, page) => {
    const haystack = searchable(text);
    let count = 0;
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) count += 1;
    if (count) out.push({ page, count });
  });
  return out;
}

/** Read a response body to bytes, failing with "size" past `max` even when
 * a proxy drops Content-Length. */
export async function readBoundedBytes(response: Response, signal: AbortSignal, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("size");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error("size");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
