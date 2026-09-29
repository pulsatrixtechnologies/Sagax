// Wraps a transcript so its image thumbnails share one lightbox: clicking any
// picture opens the viewer at that picture, and next/previous walk every
// image in the conversation in reading order.
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { AttachmentPreviewDialog, type PreviewImage } from "./AttachmentPreview";
import {
  ConversationGalleryContext,
  orderGalleryEntries,
  type ConversationGalleryRegistry,
  type GalleryEntry,
} from "./conversation-gallery-context";

export function ConversationGalleryProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, GalleryEntry>());
  const [open, setOpen] = useState<{ images: PreviewImage[]; index: number } | null>(null);

  const register = useCallback((id: string, entry: GalleryEntry) => {
    entries.current.set(id, entry);
    return () => {
      if (entries.current.get(id) === entry) entries.current.delete(id);
    };
  }, []);

  const openAt = useCallback((id: string) => {
    const ordered = orderGalleryEntries([...entries.current].map(([key, entry]) => ({ id: key, entry })));
    const selected = entries.current.get(id);
    if (!selected?.image.src) return false;
    let index = ordered.findIndex((item) => item.id === id);
    // a collapsed duplicate still opens on the picture it shows
    if (index < 0) index = ordered.findIndex((item) => item.entry.image.src === selected.image.src);
    if (index < 0) return false;
    setOpen({ images: ordered.map((item) => item.entry.image), index });
    return true;
  }, []);

  const registry = useMemo<ConversationGalleryRegistry>(() => ({ register, open: openAt }), [register, openAt]);

  return (
    <ConversationGalleryContext.Provider value={registry}>
      {children}
      {open && open.images[open.index] && (
        <AttachmentPreviewDialog
          image={open.images[open.index]!}
          images={open.images}
          initialIndex={open.index}
          onClose={() => setOpen(null)}
        />
      )}
    </ConversationGalleryContext.Provider>
  );
}
