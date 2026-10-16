import { describe, expect, it } from "vitest";
import { clampPdfZoom, isPdfBytes, pdfFitWidthScale, pdfjsAssetOptions, pdfSearchPages, pdfZoomStep, readBoundedBytes, PDF_ZOOM_MAX, PDF_ZOOM_MIN } from "./pdf-view";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("pdf viewer helpers", () => {
  it("recognizes the PDF signature, with leading junk allowed", () => {
    expect(isPdfBytes(bytes("%PDF-1.7\n..."))).toBe(true);
    expect(isPdfBytes(bytes("\n\n  %PDF-2.0"))).toBe(true);
    expect(isPdfBytes(bytes("<html>%PD"))).toBe(false);
    expect(isPdfBytes(new Uint8Array(0))).toBe(false);
  });
  it("steps the zoom and clamps it", () => {
    expect(pdfZoomStep(1, 1)).toBe(1.1);
    expect(pdfZoomStep(1, -1)).toBe(0.9);
    expect(pdfZoomStep(1.05, -1)).toBe(1);
    expect(pdfZoomStep(PDF_ZOOM_MAX, 1)).toBe(PDF_ZOOM_MAX);
    expect(pdfZoomStep(PDF_ZOOM_MIN, -1)).toBe(PDF_ZOOM_MIN);
    expect(clampPdfZoom(99)).toBe(PDF_ZOOM_MAX);
    expect(pdfFitWidthScale(612, 644)).toBe(1);
  });
  it("finds pages with the query, ignoring case, accents and spacing", () => {
    const pages = ["Facture  ÉLECTRIQUE", "rien ici", "électrique, électrique"];
    expect(pdfSearchPages(pages, "electrique")).toEqual([{ page: 0, count: 1 }, { page: 2, count: 2 }]);
    expect(pdfSearchPages(pages, "facture électrique")).toEqual([{ page: 0, count: 1 }]);
    expect(pdfSearchPages(pages, "  ")).toEqual([]);
  });
  it("reads bytes within the bound and refuses past it", async () => {
    const signal = new AbortController().signal;
    expect(await readBoundedBytes(new Response(bytes("%PDF-1.4")), signal, 100)).toEqual(bytes("%PDF-1.4"));
    await expect(readBoundedBytes(new Response(new Uint8Array(101)), signal, 100)).rejects.toThrow("size");
    await expect(readBoundedBytes(new Response("", { headers: { "content-length": "101" } }), signal, 100)).rejects.toThrow("size");
    await expect(readBoundedBytes(new Response("abc"), AbortSignal.abort(), 100)).rejects.toThrow();
  });

  it("points pdf.js at the app's own data files, by version", () => {
    expect(pdfjsAssetOptions("6.3.289", "http://127.0.0.1:8799/")).toEqual({
      cMapUrl: "http://127.0.0.1:8799/assets/pdfjs-6.3.289/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "http://127.0.0.1:8799/assets/pdfjs-6.3.289/standard_fonts/",
      wasmUrl: "http://127.0.0.1:8799/assets/pdfjs-6.3.289/wasm/",
      iccUrl: "http://127.0.0.1:8799/assets/pdfjs-6.3.289/iccs/",
      useSystemFonts: false,
    });
    // an app served under a sub path keeps its root
    expect(pdfjsAssetOptions("6.3.289", "https://example.test/app/").cMapUrl).toBe("https://example.test/app/assets/pdfjs-6.3.289/cmaps/");
  });
});
