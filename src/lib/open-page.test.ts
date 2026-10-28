// The page open over a conversation (src/lib/open-page.ts): one at a time,
// closed by its own id only, and each page keeps the place its reader had,
// so closing and opening it again (or a redraw) starts there.
import { afterEach, describe, expect, it, vi } from "vitest";

import { closePagePanel, currentOpenPage, latestPageVersionIn, openPageFor, openPagePanel, pagePlace, rememberPagePlace, resetOpenPage } from "./open-page";

afterEach(() => resetOpenPage());

const page = { pageId: "abcdefgh12345678", botId: "b1", threadId: "t1", title: "Bilan" };

describe("the open page", () => {
  it("opens one page, closes it by its own id, and keeps its place across a close and a reopen", () => {
    openPagePanel(page);
    expect(currentOpenPage()).toMatchObject(page);
    rememberPagePlace(page.pageId, 480);
    closePagePanel("someotherpage123");
    expect(currentOpenPage()).not.toBeNull();
    closePagePanel(page.pageId);
    expect(currentOpenPage()).toBeNull();
    openPagePanel(page);
    expect(pagePlace(page.pageId)).toBe(480);
  });

  it("refuses an id that is not a page id, and a bad place", () => {
    openPagePanel({ ...page, pageId: "../x" });
    expect(currentOpenPage()).toBeNull();
    rememberPagePlace(page.pageId, -1);
    rememberPagePlace(page.pageId, 1.5);
    expect(pagePlace(page.pageId)).toBe(0);
  });

  it("belongs to its bot's conversation only", () => {
    expect(openPageFor(page, "b1", undefined)).toMatchObject(page);
    expect(openPageFor(page, "b2", undefined)).toBeNull();
    expect(openPageFor(page, "b1", "t2")).toBeNull();
  });

  it("follows the newest version the conversation names", () => {
    const messages = [{}, { pagePublish: { pageId: page.pageId, version: 1 } }, { pagePublish: { pageId: "otherpage1234567", version: 9 } }, { pagePublish: { pageId: page.pageId, version: 3 } }];
    expect(latestPageVersionIn(messages, page.pageId)).toBe(3);
    expect(latestPageVersionIn([], page.pageId)).toBeUndefined();
  });
});

describe("after a restart", () => {
  it("nothing reopens by itself: the open page is never saved, so a deleted page cannot trap the app on start", async () => {
    const writes: string[] = [];
    const storage = { setItem: (key: string) => { writes.push(key); }, getItem: () => null, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    try {
      openPagePanel(page);
      rememberPagePlace(page.pageId, 120);
      expect(writes).toEqual([]);
      // a fresh start of the module (the app's next launch)
      vi.resetModules();
      const fresh = await import("./open-page");
      expect(fresh.currentOpenPage()).toBeNull();
      expect(fresh.pagePlace(page.pageId)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
