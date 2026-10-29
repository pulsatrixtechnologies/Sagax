// The split view's window (#1504): the main chat alone until a split, then
// its sections with the handles between them and each one's own header.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/state/store";
import { insertSection, MAIN_LEAF, resetSplitLayout, setSplitLayout } from "@/lib/split-view";

vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
  useMacInsetChrome: () => ({}),
}));

import { SplitWorkspace } from "./SplitWorkspace";

const render = () => renderToStaticMarkup(createElement(StoreProvider, null, createElement(SplitWorkspace, { main: createElement("main", { "data-test-main": "" }, "Main chat") })));

beforeEach(() => {
  vi.stubGlobal("window", { ogb: undefined });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  resetSplitLayout();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSplitLayout();
});

describe("the split view", () => {
  it("is the main chat alone while the window is whole", () => {
    const markup = render();
    expect(markup).toContain("data-test-main");
    expect(markup).not.toContain("data-split-leaf");
    expect(markup).not.toContain('role="separator"');
  });

  it("lays the main chat and a section side by side, a handle between them", () => {
    setSplitLayout(insertSection(MAIN_LEAF, { kind: "bot", botId: "scout" }, "right").layout);
    const markup = render();
    expect(markup).toContain('data-split-workspace="split"');
    expect(markup).toContain('data-split-branch="row"');
    expect(markup.indexOf("data-test-main")).toBeLessThan(markup.indexOf("data-split-close"));
    expect(markup).toMatch(/role="separator" aria-orientation="vertical" aria-label="Resize the sections"[^>]*aria-valuenow="50"/);
    // the section waits for its bot, with Close
    expect(markup).toContain('aria-label="Close this section"');
  });

  it("stacks sections in a column", () => {
    setSplitLayout(insertSection(MAIN_LEAF, { kind: "group", groupId: "room" }, "bottom").layout);
    const markup = render();
    expect(markup).toContain('data-split-branch="column"');
    expect(markup).toContain('aria-orientation="horizontal"');
  });
});
