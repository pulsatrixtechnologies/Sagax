// @vitest-environment happy-dom
// A page that cannot be drawn (0.8.11: a deleted page left the open page on
// "This page does not exist." with a spinner that never ended, and × did not
// answer in the desktop app). The page says it is gone, with Close, and no
// spinner; × and Escape close it in every state (loading, error, gone),
// without any request; the page's surface is never a window drag region; and
// the card says "Page deleted", frames nothing but the page's own preview
// address, and says "Preview unavailable" otherwise, never the app.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ApiError } = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;
    body?: Record<string, unknown>;
    constructor(message: string, status: number, body?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

type Mode = "ok" | "gone" | "pending" | "error" | "badPath";
let mode: Mode = "ok";
const calls: string[] = [];
const summary = { id: "abcdefgh12345678", title: "Demo KPI Dashboard", status: "draft", access: "private", expiresAt: null, currentVersion: null, botId: "b1", threadId: "t1", createdAt: 1, updatedAt: 1, expired: false, versions: [{ n: 1, kind: "html", title: "Demo", createdAt: 1, state: "proposed", bytes: 10, botId: "b1" }] };

vi.mock("@/state/store", () => ({
  api: vi.fn(async (path: string) => {
    calls.push(path);
    if (path === "/api/pages/policy") return { linkSharing: true, readerComments: true };
    if (mode === "pending") return new Promise(() => {});
    if (mode === "gone") throw new ApiError("This page does not exist.", 404, { error: "This page does not exist.", code: "not_found" });
    if (mode === "error") throw new ApiError("500 Server Error", 500, {});
    const version = /\/versions\/(\d+)$/.exec(path);
    if (version) return { version: { n: 1, kind: "html", title: "T", state: "proposed", previewPath: mode === "badPath" ? "/" : `/pages/preview/abcdefgh12345678/${version[1]}` } };
    return { page: summary };
  }),
  useStore: () => ({ state: { groups: [] }, dispatch: vi.fn() }),
  ApiError,
}));

vi.mock("./WidgetFrame", () => ({ useWidgetTheme: () => ({ scheme: "light", css: "" }) }));

import { PageSurface } from "./PageViewer";
import { PagePublishCard } from "./PublishedPages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  mode = "ok";
  calls.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const spinner = () => host.querySelector(".animate-spin");

function surface(onClose = vi.fn()) {
  act(() => root!.render(createElement(PageSurface, { pageId: "abcdefgh12345678", version: 1, initialTitle: "Demo KPI Dashboard", onClose })));
  return onClose;
}

describe("the open page that cannot be drawn", () => {
  it("a deleted page says so with Close, and no spinner", async () => {
    mode = "gone";
    const onClose = surface();
    await flush();
    expect(host.querySelector("[data-page-unavailable='gone']")).not.toBeNull();
    expect(spinner()).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    act(() => (host.querySelector("[data-page-unavailable-close]") as HTMLButtonElement).click());
    act(() => (host.querySelector("[data-page-close]") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("an error or a preview address that is not the page's ends on Preview unavailable, never a spinner or the app", async () => {
    for (const next of ["error", "badPath"] as const) {
      mode = next;
      act(() => root!.unmount());
      root = createRoot(host);
      surface();
      await flush();
      expect(host.querySelector("[data-page-unavailable='failed']"), next).not.toBeNull();
      expect(spinner(), next).toBeNull();
      expect(host.querySelector("iframe"), next).toBeNull();
    }
  });

  it("× and Escape close while the page is still loading, with no request", async () => {
    mode = "pending";
    const onClose = surface();
    await flush();
    const before = calls.length;
    act(() => (host.querySelector("[data-page-close]") as HTMLButtonElement).click());
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(calls.length).toBe(before);
  });

  it("the page is never a window drag region: × always takes the click in the desktop app", async () => {
    surface();
    await flush();
    expect(host.querySelector("[data-page-surface]")!.classList.contains("window-no-drag")).toBe(true);
    expect(host.querySelector("[data-page-close]")!.classList.contains("window-no-drag")).toBe(true);
  });
});

function card() {
  const message = { id: "m1", role: "bot", kind: "text", text: "page", at: 1, pagePublish: { pageId: "abcdefgh12345678", version: 1, title: "Demo KPI Dashboard" } };
  act(() => root!.render(createElement(PagePublishCard, { message } as never)));
}

describe("the page's card", () => {
  it("frames the page's own preview address and nothing else", async () => {
    card();
    await flush();
    const frames = [...host.querySelectorAll("iframe")];
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute("src")).toMatch(/^\/pages\/preview\/abcdefgh12345678\/1\?bare=1&theme=light$/);
  });

  it("a preview address that is not the page's frames nothing: Preview unavailable", async () => {
    mode = "badPath";
    card();
    await flush();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("[data-page-thumb-unavailable]")?.textContent).toBe("Preview unavailable");
    expect(spinner()).toBeNull();
  });

  it("a deleted page's card says Page deleted, frames nothing and does not open", async () => {
    mode = "gone";
    card();
    await flush();
    expect(host.querySelector("[data-page-card-state]")?.getAttribute("data-page-card-state")).toBe("deleted");
    expect(host.querySelector("[data-page-card-state]")?.textContent).toContain("Page deleted");
    expect(host.querySelector("iframe")).toBeNull();
    expect((host.querySelector("[data-page-open]") as HTMLButtonElement).disabled).toBe(true);
  });
});
