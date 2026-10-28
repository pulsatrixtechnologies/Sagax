// The picture at the start of a Library row (2026-10-28): the file's own small
// thumbnail for an image, otherwise one mark per type. A thumbnail is the
// server's 96 px square (?thumb=1), lazy loaded, never the full picture; if it
// cannot load, the row falls back to the image icon.
import { useState } from "react";
import { FileArchive, FileCode, FileIcon, FileText, Film, ImageIcon, Music } from "lucide-react";

import { threadFileThumbUrl, type ThreadFile } from "@/lib/chat-files";
import { fileGlyphKind, type LibraryGlyphKind } from "@/lib/library-glyph";
import { cn } from "@/lib/cn";
import { PageGlyph } from "../PageViewer";

const SIZE = 24;

/** A colored mark for each type that is not a thumbnail. */
function TypeGlyph({ kind }: { kind: Exclude<LibraryGlyphKind, "thumbnail"> }) {
  switch (kind) {
    case "page":
      return <PageGlyph size={SIZE - 4} />;
    case "pdf":
      return (
        <span aria-hidden="true" data-glyph-pdf className="flex size-5 items-center justify-center rounded-[5px] bg-red-500/15 text-[8px] font-bold leading-none tracking-tight text-red-500">PDF</span>
      );
    case "archive":
      return <FileArchive size={16} aria-hidden="true" className="text-amber-500" />;
    case "document":
      return <FileText size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "code":
      return <FileCode size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "video":
      return <Film size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "audio":
      return <Music size={16} aria-hidden="true" className="text-ink-secondary" />;
    case "image":
      return <ImageIcon size={16} aria-hidden="true" className="text-ink-secondary" />;
    default:
      return <FileIcon size={16} aria-hidden="true" className="text-ink-secondary" />;
  }
}

export function FileGlyph({ threadId, file }: { threadId: string; file: ThreadFile }) {
  const [failed, setFailed] = useState(false);
  const kind = fileGlyphKind(file);
  if (kind === "thumbnail" && !failed) {
    return (
      <img
        src={threadFileThumbUrl(threadId, file.id)}
        alt=""
        loading="lazy"
        decoding="async"
        data-library-thumb=""
        width={SIZE}
        height={SIZE}
        onError={() => setFailed(true)}
        className={cn("size-6 shrink-0 rounded-md bg-inset object-cover ring-1 ring-hairline-weak")}
      />
    );
  }
  return <span data-library-glyph={kind === "thumbnail" ? "image" : kind} className="flex size-6 items-center justify-center"><TypeGlyph kind={kind === "thumbnail" ? "image" : kind} /></span>;
}

/** An artifact or a published page: the page mark. */
export function PageRowGlyph() {
  return <span data-library-glyph="page" className="flex size-6 items-center justify-center"><TypeGlyph kind="page" /></span>;
}
