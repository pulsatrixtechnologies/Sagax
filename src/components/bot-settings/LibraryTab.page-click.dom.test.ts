// @vitest-environment happy-dom
// A click on a page in the Library opens the full panel over the conversation
// (the open-page store the chat card writes to), never a system window.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { closePagePanel, currentOpenPage } from "@/lib/open-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { LibraryBody } = await import("./LibraryTab");

const now = Date.parse("2026-10-26T12:00:00Z");
const page = {
  id: "pageAAAA1111", title: "Weekly KPIs", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "bot1", threadId: "t1",
  createdAt: now - 1000, updatedAt: now - 1000, expired: false, versions: [], pinned: false,
};

let root: Root | null = null;
const windowOpen = vi.fn();
const artifactWindowOpen = vi.fn(async () => "created");
beforeEach(() => {
  setLocale("en");
  (window as unknown as { open: unknown }).open = windowOpen;
  (window as unknown as { ogb: unknown }).ogb = { artifactWindow: { open: artifactWindowOpen } };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  closePagePanel();
  windowOpen.mockClear();
  artifactWindowOpen.mockClear();
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(LibraryBody, { threadId: "t1", files: [], list: { artifacts: [], error: false, reload: () => {}, patch: () => {} }, pages: [page] as never, now })));
  return host;
}

describe("Library: a page opens the full panel", () => {
  it("a click on the row opens the panel, not a window", () => {
    const host = mount();
    act(() => host.querySelector<HTMLElement>("[data-page-open]")!.click());
    expect(currentOpenPage()).toMatchObject({ pageId: "pageAAAA1111", botId: "bot1", threadId: "t1", title: "Weekly KPIs" });
    expect(artifactWindowOpen).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
