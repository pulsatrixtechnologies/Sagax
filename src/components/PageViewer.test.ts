// The full-page viewer of a published page (src/components/PageViewer.tsx):
// annotations come only from the preview's own frame and are plain text; the
// message to the bot names the page by its title, never an id; Save and
// publish keeps the page's access and a future expiry only.
import { describe, expect, it } from "vitest";

import { annotationPrompt, parseAnnotationMessage, PAGE_ANNOTATION_MESSAGE } from "../../shared/published-pages";
import { previewSrc } from "./page-controls";
import { acceptAnnotation, republishBody } from "./PageViewer";

const message = (extra: Record<string, unknown> = {}) => ({ type: PAGE_ANNOTATION_MESSAGE, v: 1, n: 1, tag: "H1", text: " Rapport \n mensuel ", path: "body > h1", ...extra });

describe("annotations from the preview frame", () => {
  it("parses a well-formed message and cuts its text to one short line", () => {
    expect(parseAnnotationMessage(message())).toEqual({ n: 1, tag: "h1", text: "Rapport mensuel", path: "body > h1" });
    const long = parseAnnotationMessage(message({ text: "x".repeat(500) }))!;
    expect(long.text.length).toBeLessThanOrEqual(160);
    for (const bad of [null, "x", message({ type: "other" }), message({ v: 2 }), message({ n: 0 }), message({ n: "1" }), message({ tag: "<img onerror=x>" })]) {
      expect(parseAnnotationMessage(bad)).toBeNull();
    }
  });

  it("accepts a message only from the frame inside the viewer's wrapper", () => {
    const frame = {} as Window;
    const other = {} as Window;
    const list = acceptAnnotation([], { source: frame, data: message() }, frame);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ n: 1, anchor: { tag: "h1" }, note: "" });
    expect(acceptAnnotation(list, { source: other, data: message({ n: 2 }) }, frame)).toBe(list);
    expect(acceptAnnotation(list, { source: frame, data: message({ n: 2 }) }, null)).toBe(list);
    // the same number twice is one annotation
    expect(acceptAnnotation(list, { source: frame, data: message() }, frame)).toBe(list);
  });

  it("the message to the bot names the page by its title and version, never an id", () => {
    const text = annotationPrompt({
      title: "Bilan",
      version: 3,
      items: [{ anchor: { tag: "h1", text: "Rapport", path: "body > h1" }, note: "Plus court" }, { anchor: { tag: "p", text: "", path: "p" }, note: "" }],
    });
    expect(text).toContain("« Bilan » (version 3)");
    expect(text).toContain("1. <h1> « Rapport » : Plus court");
    expect(text).toContain("2. <p> : (sans note)");
    expect(text).not.toMatch(/[A-Za-z0-9_-]{16,}/);
  });
});

describe("the viewer's frame and Save and publish", () => {
  it("frames the preview wrapper only, with the annotation flag at most", () => {
    expect(previewSrc("/pages/preview/abcdefgh12345678/2", { annotate: true })).toBe("/pages/preview/abcdefgh12345678/2?annotate=1");
    expect(previewSrc("/pages/preview/abcdefgh12345678/2?x=1", { annotate: true })).toBeNull();
  });

  it("keeps the page's access, and its expiry only while still ahead", () => {
    const now = 1_000;
    expect(republishBody({ access: "org", expiresAt: 5_000 }, 4, now)).toEqual({ version: 4, access: "org", expiresAt: 5_000 });
    expect(republishBody({ access: "link", expiresAt: 500 }, 4, now)).toEqual({ version: 4, access: "link", expiresAt: null });
  });
});
