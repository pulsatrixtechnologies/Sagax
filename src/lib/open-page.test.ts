// The page open over a conversation (src/lib/open-page.ts): one at a time,
// closed by its own id only, and each page keeps the place its reader had,
// so closing and opening it again (or a redraw) starts there.
import { afterEach, describe, expect, it, vi } from "vitest";

const ownWindow = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./page-windows", () => ({ openPageInOwnWindow: ownWindow }));

import { closePagePanel, currentOpenPage, hasPagePanelHost, latestPageVersionIn, openPage, openPageFor, openPagePanel, pageOpenWay, pagePlace, registerPagePanelHost, rememberPagePlace, resetOpenPage } from "./open-page";

afterEach(() => { resetOpenPage(); ownWindow.mockClear(); });

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

describe("openPage, the one way a page opens", () => {
  it("opens the panel while the page's conversation is on screen, else a window of its own", async () => {
    // no conversation on screen (the Library of a bot whose chat is not open): a window
    expect(await openPage(page)).toBe("window");
    expect(ownWindow).toHaveBeenCalledWith({ id: page.pageId, botId: "b1", title: "Bilan" });
    expect(currentOpenPage()).toBeNull();
    // the conversation on screen: the panel, and nothing else opens
    const leave = registerPagePanelHost("b1");
    expect(hasPagePanelHost("b1")).toBe(true);
    ownWindow.mockClear();
    expect(await openPage(page)).toBe("panel");
    expect(currentOpenPage()).toMatchObject(page);
    expect(ownWindow).not.toHaveBeenCalled();
    // asked for a window: a window, even with the conversation on screen
    closePagePanel();
    expect(await openPage(page, "window")).toBe("window");
    expect(currentOpenPage()).toBeNull();
    // the conversation left the screen
    leave();
    leave();
    expect(hasPagePanelHost("b1")).toBe(false);
  });

  it("counts the conversations on screen for a bot, and never hosts another bot's page", async () => {
    const first = registerPagePanelHost("b1");
    const second = registerPagePanelHost("b1");
    first();
    expect(hasPagePanelHost("b1")).toBe(true);
    expect(await openPage({ ...page, botId: "b2" })).toBe("window");
    second();
    expect(hasPagePanelHost("b1")).toBe(false);
    expect(await openPage(page)).toBe("window");
  });

  it("says where a page goes (pure), and opens nothing for a bad id or when no window can open", async () => {
    expect(pageOpenWay("panel", true)).toBe("panel");
    expect(pageOpenWay("panel", false)).toBe("window");
    expect(pageOpenWay("window", true)).toBe("window");
    expect(await openPage({ ...page, pageId: "../x" })).toBeNull();
    expect(ownWindow).not.toHaveBeenCalled();
    ownWindow.mockResolvedValueOnce(false);
    expect(await openPage(page)).toBeNull();
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
