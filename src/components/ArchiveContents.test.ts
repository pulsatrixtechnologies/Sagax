import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ArchiveSummary } from "@/lib/composer-attachments";
import { archiveCountLabel, ArchiveContentsView } from "./ArchiveContents";
import { ComposerAttachments } from "./ComposerAttachments";

const summary: ArchiveSummary = {
  kind: "zip", status: "ok", files: 3, totalBytes: 3072, truncated: true, skippedCount: 0,
  entries: [{ path: "project/README.md", size: 1024 }, { path: "project/src/main.ts", size: 2048 }],
};
const view = (open: boolean, value = summary) => renderToStaticMarkup(createElement(ArchiveContentsView, { summary: value, open, onToggle: () => {}, listId: "l" }));

describe("archive chip contents", () => {
  it("shows the file count, and the list only when asked", () => {
    const closed = view(false);
    expect(closed).toContain("3 files");
    expect(closed).toContain("Show contents");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("project/README.md");
    const opened = view(true);
    expect(opened).toContain("Hide contents");
    expect(opened).toContain("project/README.md");
    expect(opened).toContain("2.0 KB");
    expect(opened).toContain("and 1 more files");
  });

  it("says when the archive was not unpacked", () => {
    expect(archiveCountLabel({ files: 1, status: "ok" })).toBe("1 file");
    expect(archiveCountLabel({ files: 4, status: "encrypted" })).toBe("4 files · password-protected, kept as is");
    expect(archiveCountLabel({ files: 0, status: "unsupported" })).toBe("Not unpacked: format not supported");
    expect(view(false, { ...summary, entries: [], files: 0, status: "invalid" })).not.toContain("Show contents");
  });

  it("the composer shows an uploaded archive as an ARCHIVE chip with its name, size and count", () => {
    const html = renderToStaticMarkup(createElement(ComposerAttachments, {
      items: [{ kind: "file", id: "a", path: "/p/x.zip", name: "project.zip", size: 2_400_000, archive: summary }],
      onAdd: () => {}, onRemove: () => {}, onChangeCitation: () => {}, onDisplayInChatBox: () => {},
      notice: null, onNotice: () => {}, uploadImage: async () => null,
    }));
    expect(html).toContain("ARCHIVE");
    expect(html).toContain("project.zip");
    expect(html).toContain("2.3 MB");
    expect(html).toContain("3 files");
    expect(html).toContain("Show contents");
  });
});
