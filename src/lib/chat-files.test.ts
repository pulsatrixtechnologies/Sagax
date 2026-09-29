import { describe, expect, it } from "vitest";

import {
  classifyFile,
  countByFilter,
  fileExtension,
  filesSignature,
  filterForKind,
  originOf,
  sortFiles,
  threadFileUrl,
  visibleFiles,
  type ThreadFile,
} from "./chat-files";

const file = (name: string, patch: Partial<ThreadFile> = {}): ThreadFile => ({
  id: name,
  messageId: `m-${name}`,
  source: "written",
  path: `/w/${name}`,
  name,
  at: 0,
  size: 1,
  available: true,
  ...patch,
});

describe("classifyFile", () => {
  it("trusts a meaningful MIME type first", () => {
    expect(classifyFile({ name: "x.bin", mime: "image/png" })).toBe("image");
    expect(classifyFile({ name: "x", mime: "video/quicktime" })).toBe("video");
    expect(classifyFile({ name: "x", mime: "audio/mpeg" })).toBe("audio");
    expect(classifyFile({ name: "x", mime: "application/pdf" })).toBe("document");
    expect(classifyFile({ name: "x", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe("document");
    expect(classifyFile({ name: "x", mime: "application/vnd.oasis.opendocument.text" })).toBe("document");
    expect(classifyFile({ name: "notes.md", mime: "text/markdown; charset=utf-8" })).toBe("document");
    expect(classifyFile({ name: "x", mime: "text/plain" })).toBe("document");
    expect(classifyFile({ name: "x", mime: "application/json" })).toBe("code");
    expect(classifyFile({ name: "x", mime: "text/x-python" })).toBe("code");
    expect(classifyFile({ name: "x", mime: "application/geo+json" })).toBe("code");
    expect(classifyFile({ name: "x", mime: "application/zip" })).toBe("archive");
  });

  it("falls back to the extension for a missing, generic or unknown type", () => {
    expect(classifyFile({ name: "photo.JPG" })).toBe("image");
    expect(classifyFile({ name: "clip.mov", mime: "application/octet-stream" })).toBe("video");
    expect(classifyFile({ name: "song.flac", mime: "" })).toBe("audio");
    expect(classifyFile({ name: "deck.pptx", mime: "application/x-unknown" })).toBe("document");
    expect(classifyFile({ name: "app.tsx", mime: "application/octet-stream" })).toBe("code");
    expect(classifyFile({ name: "Dockerfile" })).toBe("code");
    expect(classifyFile({ name: "backup.tar.gz" })).toBe("archive");
    expect(classifyFile({ name: "README" })).toBe("other");
    expect(classifyFile({ name: "firmware.bin", mime: "application/octet-stream" })).toBe("other");
    expect(classifyFile({ name: ".env" })).toBe("other");
  });

  it("puts archives under the Other chip", () => {
    expect(filterForKind("archive")).toBe("other");
    expect(filterForKind("image")).toBe("image");
  });

  it("reads extensions from names and paths", () => {
    expect(fileExtension("/a/b/Report.Final.PDF")).toBe("pdf");
    expect(fileExtension("C:\\x\\y.ts")).toBe("ts");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("makefile")).toBe("makefile");
  });
});

describe("filtering and sorting", () => {
  const files = [
    file("b.png", { at: 3, size: 500, source: "upload" }),
    file("a.pdf", { at: 1, size: 9000, source: "attachment" }),
    file("c.ts", { at: 2, size: null, available: false }),
    file("song.mp3", { at: 4, size: 10 }),
    file("pack.zip", { at: 5, size: 70 }),
    file("File 10.md", { at: 6, size: 1 }),
    file("File 9.md", { at: 7, size: 1 }),
  ];
  const query = { filter: "all" as const, origin: "all" as const, search: "", sort: "newest" as const };

  it("counts every chip under the current search and origin", () => {
    expect(countByFilter(files, query)).toEqual({ all: 7, image: 1, video: 0, audio: 1, document: 3, code: 1, other: 1 });
    expect(countByFilter(files, { origin: "you", search: "" })).toMatchObject({ all: 1, image: 1, document: 0 });
    expect(countByFilter(files, { origin: "all", search: "FILE" })).toMatchObject({ all: 2, document: 2, image: 0 });
  });

  it("filters by kind, origin and a case-insensitive name search", () => {
    expect(visibleFiles(files, { ...query, filter: "document" }).map((f) => f.name)).toEqual(["File 9.md", "File 10.md", "a.pdf"]);
    expect(visibleFiles(files, { ...query, filter: "other" }).map((f) => f.name)).toEqual(["pack.zip"]);
    expect(visibleFiles(files, { ...query, origin: "bot", filter: "image" })).toEqual([]);
    expect(visibleFiles(files, { ...query, search: " SONG " }).map((f) => f.name)).toEqual(["song.mp3"]);
    expect(visibleFiles(files, { ...query, filter: "video" })).toEqual([]);
    expect(originOf({ source: "upload" })).toBe("you");
    expect(originOf({ source: "written" })).toBe("bot");
  });

  it("sorts newest first, by natural name, or by size with unknown sizes last", () => {
    expect(sortFiles(files, "newest").map((f) => f.at)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(sortFiles(files, "name").map((f) => f.name)).toEqual(["a.pdf", "b.png", "c.ts", "File 9.md", "File 10.md", "pack.zip", "song.mp3"]);
    expect(sortFiles(files, "size").map((f) => f.name)).toEqual(["a.pdf", "b.png", "pack.zip", "song.mp3", "File 9.md", "File 10.md", "c.ts"]);
    // The input is not reordered in place.
    expect(files[0]!.name).toBe("b.png");
  });
});

describe("live refresh and URLs", () => {
  it("changes its signature when a message lands, a tool settles or an attachment arrives", () => {
    const base = [{ id: "1", kind: "text" }, { id: "2", kind: "activity", tool: {} }];
    const settled = [{ id: "1", kind: "text" }, { id: "2", kind: "activity", tool: { ok: true } }];
    const attached = [{ id: "1", kind: "text", attachments: [{}] }, { id: "2", kind: "activity", tool: {} }];
    expect(filesSignature(base)).not.toBe(filesSignature(settled));
    expect(filesSignature(base)).not.toBe(filesSignature(attached));
    expect(filesSignature(base)).not.toBe(filesSignature([...base, { id: "3", kind: "text" }]));
    expect(filesSignature(base)).toBe(filesSignature([...base]));
  });

  it("builds id-based URLs that never carry a host path", () => {
    expect(threadFileUrl("t-1", "abc")).toBe("/api/threads/t-1/files/abc");
    expect(threadFileUrl("t-1", "abc", true)).toBe("/api/threads/t-1/files/abc?preview=1");
  });
});
