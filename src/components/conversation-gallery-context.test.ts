import { describe, expect, it } from "vitest";

import { orderGalleryEntries, type GalleryEntry } from "./conversation-gallery-context";
import { wrappedImageIndex } from "./AttachmentPreview";

/** A stand-in element whose document position is its index. */
function element(position: number, connected = true): Element {
  return {
    isConnected: connected,
    compareDocumentPosition(other: Element) {
      const theirs = (other as unknown as { position: number }).position;
      return theirs > position ? 4 : theirs < position ? 2 : 0;
    },
    position,
  } as unknown as Element;
}

const entry = (id: string, position: number, src = `/img/${id}.png`, connected = true): { id: string; entry: GalleryEntry } => ({
  id,
  entry: { element: element(position, connected), image: { src, name: id } },
});

describe("conversation gallery", () => {
  it("orders images by their place in the transcript, not by registration", () => {
    const ordered = orderGalleryEntries([entry("third", 30), entry("first", 10), entry("second", 20)]);
    expect(ordered.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });

  it("skips unmounted and not-yet-loadable images and collapses back-to-back repeats", () => {
    const ordered = orderGalleryEntries([
      entry("a", 1),
      entry("gone", 2, "/img/gone.png", false),
      entry("hidden", 3, ""),
      entry("a-again", 4, "/img/a.png"),
      entry("b", 5),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("walks the whole conversation with wraparound", () => {
    const ordered = orderGalleryEntries([entry("m1-img", 1), entry("m2-img", 2), entry("m3-img", 3)]);
    const last = ordered.length - 1;
    expect(ordered[wrappedImageIndex(last, 1, ordered.length)]!.id).toBe("m1-img");
    expect(ordered[wrappedImageIndex(0, -1, ordered.length)]!.id).toBe("m3-img");
  });
});
