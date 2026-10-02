import { describe, expect, it } from "vitest";

import { cleanUrl, collectBotLinks, fileKind, linksInText, mergeBotFiles, pageOf, readPageQuery } from "./bot-library.ts";
import type { ThreadFile } from "./thread-files.ts";

describe("bot links", () => {
  it("finds bare and Markdown links, trimming sentence punctuation", () => {
    expect(linksInText("See https://example.test/a, and [the docs](https://docs.example.test/x_(y)).")).toEqual([
      { url: "https://example.test/a" },
      { url: "https://docs.example.test/x_(y)", title: "the docs" },
    ]);
    expect(linksInText("(https://example.test/paren) end.")).toEqual([{ url: "https://example.test/paren" }]);
    expect(linksInText("ftp://nope.test javascript:alert(1) http://user:pw@host.test")).toEqual([]);
  });

  it("rejects what is not a usable web address", () => {
    expect(cleanUrl("https://example.test/ok!")).toBe("https://example.test/ok");
    expect(cleanUrl("https://")).toBeNull();
    expect(cleanUrl(`https://example.test/${"a".repeat(3000)}`)).toBeNull();
  });

  it("deduplicates across threads at the newest mention, newest first, and keeps a title", () => {
    const links = collectBotLinks([
      { threadId: "t1", messages: [
        { id: "m1", kind: "text", text: "[Report](https://example.test/r)", at: 10 },
        { id: "m2", kind: "activity", text: "https://tool.test/ignored", at: 50 },
      ] },
      { threadId: "t2", messages: [
        { id: "m3", kind: "text", text: "again https://example.test/r", at: 30 },
        { id: "m4", text: "www https://www.Other.test/x", at: 20 },
      ] },
    ]);
    expect(links).toEqual([
      { url: "https://example.test/r", domain: "example.test", title: "Report", messageId: "m3", threadId: "t2", at: 30 },
      { url: "https://www.Other.test/x", domain: "other.test", messageId: "m4", threadId: "t2", at: 20 },
    ]);
  });
});

describe("bot files", () => {
  const file = (over: Partial<ThreadFile>): ThreadFile => ({
    id: "f".repeat(24), messageId: "m", source: "upload", path: "/x", name: "x", at: 1, size: 3, available: true, ...over,
  });

  it("splits media from files and builds the existing per-thread URLs", () => {
    const merged = mergeBotFiles([
      { threadId: "t1", files: [file({ id: "a".repeat(24), name: "photo.png", mime: "image/png", at: 5, localPath: "/secret/photo.png" })] },
      { threadId: "t2", files: [
        file({ id: "b".repeat(24), name: "clip.mp4", mime: "video/mp4", at: 9 }),
        file({ id: "c".repeat(24), name: "notes.pdf", mime: "application/pdf", at: 7 }),
      ] },
    ]);
    expect(merged.map((entry) => [entry.name, entry.kind])).toEqual([["clip.mp4", "media"], ["notes.pdf", "file"], ["photo.png", "media"]]);
    const photo = merged.find((entry) => entry.name === "photo.png")!;
    expect(photo.url).toBe(`/api/threads/t1/files/${"a".repeat(24)}`);
    expect(photo.previewUrl).toBe(`/api/threads/t1/files/${"a".repeat(24)}?preview=1`);
    expect(JSON.stringify(merged)).not.toContain("/secret/");
    expect(merged.find((entry) => entry.name === "clip.mp4")!.previewUrl).toBeUndefined();
    expect(mergeBotFiles([{ threadId: "t2", files: [file({ mime: "application/pdf" })] }], "media")).toEqual([]);
    expect(fileKind(undefined)).toBe("file");
  });

  it("pages with an opaque cursor", () => {
    expect(readPageQuery(new URLSearchParams(""))).toEqual({ ok: true, offset: 0, limit: 30 });
    expect(readPageQuery(new URLSearchParams("cursor=4&limit=500"))).toEqual({ ok: true, offset: 4, limit: 100 });
    expect(readPageQuery(new URLSearchParams("cursor=-1")).ok).toBe(false);
    expect(readPageQuery(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(pageOf([1, 2, 3], 0, 2)).toEqual({ items: [1, 2], nextCursor: "2", total: 3 });
    expect(pageOf([1, 2, 3], 2, 2)).toEqual({ items: [3], nextCursor: null, total: 3 });
  });
});
