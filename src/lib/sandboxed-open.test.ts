// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { WIDGET_OPEN_MESSAGE } from "./rich-blocks";
import { acceptWidgetOpen } from "./sandboxed-open";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("acceptWidgetOpen (#1799)", () => {
  it("opens a validated URL from the sandboxed frame via openExternal", async () => {
    const openExternal = vi.fn(async () => true);
    vi.stubGlobal("ogb", { openExternal });
    const source = {} as Window;
    const event = { source, data: { type: WIDGET_OPEN_MESSAGE, url: "https://example.com/docs" } } as MessageEvent;
    expect(acceptWidgetOpen(event, source)).toBe("https://example.com/docs");
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("ignores a message from another window or a hostile URL", () => {
    const openExternal = vi.fn(async () => true);
    vi.stubGlobal("ogb", { openExternal });
    const source = {} as Window;
    expect(acceptWidgetOpen({ source: {} as Window, data: { type: WIDGET_OPEN_MESSAGE, url: "https://example.com" } } as MessageEvent, source)).toBeNull();
    expect(acceptWidgetOpen({ source, data: { type: WIDGET_OPEN_MESSAGE, url: "javascript:alert(1)" } } as MessageEvent, source)).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("acceptPageOpen (#1799)", () => {
  it("opens a validated page-frame URL and refuses javascript:", async () => {
    const { acceptPageOpen } = await import("./sandboxed-open");
    const { PAGE_OPEN_MESSAGE } = await import("../../shared/published-pages");
    const openExternal = vi.fn(async () => true);
    vi.stubGlobal("ogb", { openExternal });
    expect(acceptPageOpen({ data: { type: PAGE_OPEN_MESSAGE, url: "https://example.com/page" } } as MessageEvent)).toBe("https://example.com/page");
    expect(acceptPageOpen({ data: { type: PAGE_OPEN_MESSAGE, url: "javascript:alert(1)" } } as MessageEvent)).toBeNull();
    await Promise.resolve();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/page");
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
