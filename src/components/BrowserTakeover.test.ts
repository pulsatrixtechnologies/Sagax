// @vitest-environment happy-dom
// The bot pane's browser behaves like the VM: a live, watch-only preview in
// the screen's frame (ComputerScreen), the same Off / Starting / Error states,
// and Take control opens the same window as the server environment's
// (SandboxDesktopModal), never full screen. While the window is open the
// square streams nothing; closing it hands control back.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api, useStore: () => ({ state: { config: { browserProfiles: [], browserEngine: { kind: "engine" } } } }) }));
vi.mock("./BrowserProfilesManager", () => ({ BrowserProfilesManager: () => null }));
import { BrowserComputerScreen, BrowserPanel } from "./BrowserPanel";

class FakeSource {
  static all: FakeSource[] = [];
  closed = false;
  listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(public url: string) { FakeSource.all.push(this); }
  addEventListener(name: string, listener: (event: Event) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data: unknown = {}) { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) })); }
  fail() { for (const listener of this.listeners.get("error") ?? []) listener(new Event("error")); }
  close() { this.closed = true; }
}

const bot = { id: "cryptic", name: "Assistant", browserProfile: "own" } as unknown as Bot;
const FRAME = { seq: 1, data: "/9j/AAAA", format: "jpeg", metadata: { deviceWidth: 1280, deviceHeight: 720 } };
let host: HTMLDivElement;
let root: Root;
const requestFullscreen = vi.fn(async () => {});

beforeEach(() => {
  FakeSource.all = [];
  api.mockReset().mockImplementation(async (path: string) => path === "/api/auth/session" ? { scopes: ["admin"] } : { ok: true });
  vi.stubGlobal("EventSource", FakeSource);
  HTMLElement.prototype.requestFullscreen = requestFullscreen;
  requestFullscreen.mockClear();
  HTMLDialogElement.prototype.showModal ??= function () {};
  HTMLDialogElement.prototype.close ??= function () {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const preview = () => FakeSource.all.filter((source) => source.url.endsWith("?preview=1"));
const live = () => FakeSource.all.filter((source) => !source.url.endsWith("?preview=1"));
const screen = () => document.querySelector("[data-computer-screen]");
const render = async () => { await act(async () => root.render(createElement(BrowserComputerScreen, { bot }))); };
const emit = async (source: FakeSource, name: string, data?: unknown) => { await act(async () => source.emit(name, data)); };
const showFrame = async () => {
  const source = preview()[0]!;
  await emit(source, "ready", { viewerId: "viewer-1" });
  await emit(source, "frame", FRAME);
};
const takeControl = () => act(async () => { (document.querySelector("[data-take-control]") as HTMLButtonElement).click(); });

describe("browser tab: a live preview like the VM's screen", () => {
  it("draws the browser in the screen's frame and connects a watch-only preview at once", async () => {
    await act(async () => root.render(createElement(BrowserPanel, { bot })));
    expect(screen()?.getAttribute("data-computer-source")).toBe("browser");
    expect(preview().map((source) => source.url)).toEqual(["/api/bots/cryptic/browser/live?preview=1"]);
    expect(screen()?.getAttribute("data-computer-screen")).toBe("starting");
    expect(document.body.textContent).toContain("Connecting to the browser…");
    expect(document.body.textContent).not.toMatch(/Nothing is streamed|full screen/);
    // No Play / Pause / Stop: a browser has no power of its own.
    expect(document.querySelector("[data-screen-controls]")).toBeNull();
  });

  it("shows each frame and acknowledges it, with Take control over the picture", async () => {
    await render();
    await showFrame();
    expect(screen()?.getAttribute("data-computer-screen")).toBe("running");
    const image = document.querySelector("[data-browser-preview] img") as HTMLImageElement;
    expect(image.src).toBe("data:image/jpeg;base64,/9j/AAAA");
    expect(image.alt).toBe("Assistant’s browser");
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(api).toHaveBeenCalledWith("/api/bots/cryptic/browser/action", expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "ack", seq: 1, viewerId: "viewer-1" }) }));
    expect(document.querySelector("[data-browser-preview][data-take-control]")?.textContent).toContain("Take control");
    // Shown on hover, always on touch, not drawn over the page otherwise.
    expect(document.querySelector("[data-take-control-pill]")?.className).toMatch(/opacity-0 .*group-hover\/preview:opacity-100 .*touch:opacity-100/);
    // The caption: one line, the whole name in its tooltip.
    const caption = document.querySelector("figcaption")!;
    expect(caption.className).toContain("truncate");
    expect(caption.getAttribute("title")).toBe("Assistant’s browser");
  });

  it("says a closed browser is off, offers Take control, and asks again later without launching it", async () => {
    vi.useFakeTimers();
    await render();
    await emit(preview()[0]!, "offline");
    expect(preview()[0]!.closed).toBe(true);
    expect(screen()?.getAttribute("data-computer-screen")).toBe("off");
    expect(document.body.textContent).toContain("Assistant’s browser is closed.");
    const take = [...document.querySelectorAll("[data-computer-screen] button")].find((button) => button.textContent === "Take control");
    expect(take).toBeDefined();
    expect(document.querySelector("[data-screen-controls]")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(preview()).toHaveLength(2);
  });

  it("shows a failed preview as an error with Try again", async () => {
    await render();
    await act(async () => preview()[0]!.fail());
    expect(screen()?.getAttribute("data-computer-screen")).toBe("error");
    const retry = [...document.querySelectorAll("button")].find((button) => button.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(preview()).toHaveLength(2);
    expect(screen()?.getAttribute("data-computer-screen")).toBe("starting");
  });
});

describe("browser tab: take control opens the VM's window, not full screen", () => {
  it("opens the window with the live browser and stops the square's preview", async () => {
    await render();
    await showFrame();
    await takeControl();
    const dialog = document.querySelector("[data-sandbox-takeover][data-takeover-kind=browser] [role=dialog]") as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-label")).toBe("Assistant’s browser");
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(dialog);
    expect(preview()[0]!.closed).toBe(true);
    expect(live().map((source) => source.url)).toEqual(["/api/bots/cryptic/browser/live"]);
    expect(document.querySelector("[data-browser-takeover-open]")?.textContent).toBe("You have control in the large window.");
    // No Play / Pause / Stop in the window's header either.
    expect(dialog.querySelector("[role=group]")).toBeNull();
  });

  it("says who has the browser in the window, with Take control, and no second toggle in the header", async () => {
    await render();
    await showFrame();
    await takeControl();
    expect(document.querySelector("[data-takeover-control]")).toBeNull();
    const source = live()[0]!;
    await emit(source, "ready", { viewerId: "viewer-live" });
    await emit(source, "control", { held: false, controlling: false, owned: false });
    expect(document.querySelector("[data-browser-holder]")?.textContent).toContain("Assistant is using the browser");
    await act(async () => (document.querySelector("[data-browser-take]") as HTMLButtonElement).click());
    expect(api).toHaveBeenCalledWith("/api/bots/cryptic/browser/action", expect.objectContaining({ body: JSON.stringify({ type: "take", viewerId: "viewer-live" }) }));
    await emit(source, "control", { held: true, controlling: true, owned: true });
    expect(document.querySelector("[data-browser-holder]")?.getAttribute("data-browser-holder")).toBe("you");
    expect(document.querySelector("[data-browser-give-back]")?.textContent).toContain("Give back control");
  });

  it("takes a blank browser to the start page when the window opens, but never moves a real page", async () => {
    await render();
    await showFrame();
    await takeControl();
    const source = live()[0]!;
    await emit(source, "ready", { viewerId: "viewer-live" });
    await emit(source, "tabs", { tabs: [{ tabId: "t1", title: "", url: "about:blank", active: true }] });
    await act(async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); });
    const sent = api.mock.calls.filter(([path]) => path === "/api/bots/cryptic/browser/action").map(([, init]) => JSON.parse(init.body).type);
    expect(sent).toEqual(expect.arrayContaining(["take", "navigate"]));
    expect(api).toHaveBeenCalledWith("/api/bots/cryptic/browser/action", expect.objectContaining({ body: JSON.stringify({ type: "navigate", url: "https://www.google.com/", viewerId: "viewer-live" }) }));
    api.mockClear();
    await emit(source, "tabs", { tabs: [{ tabId: "t1", title: "", url: "about:blank", active: true }] });
    expect(api.mock.calls.filter(([path, init]) => path === "/api/bots/cryptic/browser/action" && JSON.parse(init.body).type !== "ack")).toEqual([]);
  });

  it("leaves a page the bot has open where it is", async () => {
    await render();
    await showFrame();
    await takeControl();
    const source = live()[0]!;
    await emit(source, "ready", { viewerId: "viewer-live" });
    await emit(source, "tabs", { tabs: [{ tabId: "t1", title: "Example", url: "https://example.com/", active: true }] });
    await act(async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); });
    expect(api.mock.calls.filter(([path, init]) => path === "/api/bots/cryptic/browser/action" && JSON.parse(init.body).type !== "ack")).toEqual([]);
  });

  it("shows the last preview picture in the window while the live view connects", async () => {
    await render();
    await showFrame();
    await takeControl();
    const placeholder = document.querySelector("[data-browser-placeholder] img") as HTMLImageElement;
    expect(placeholder.src).toBe("data:image/jpeg;base64,/9j/AAAA");
    await emit(live()[0]!, "ready", { viewerId: "viewer-live" });
    await emit(live()[0]!, "frame", FRAME);
    expect(document.querySelector("[data-browser-placeholder]")).toBeNull();
  });

  it("draws a blank page as nothing open, with Take control, and keeps acknowledging frames", async () => {
    await render();
    const source = preview()[0]!;
    await emit(source, "ready", { viewerId: "viewer-1" });
    await emit(source, "tabs", { tabs: [{ tabId: "t1", title: "", url: "about:blank", active: true }] });
    await emit(source, "frame", FRAME);
    expect(document.querySelector("[data-browser-preview] img")).toBeNull();
    expect(document.querySelector("[data-browser-blank]")?.textContent).toContain("The browser is not open");
    expect(document.querySelector("[data-browser-blank] [data-take-control]")?.textContent).toContain("Take control");
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    expect(api).toHaveBeenCalledWith("/api/bots/cryptic/browser/action", expect.objectContaining({ body: JSON.stringify({ type: "ack", seq: 1, viewerId: "viewer-1" }) }));
    await emit(source, "url", { url: "https://www.google.com/" });
    expect(document.querySelector("[data-browser-preview] img")).not.toBeNull();
  });

  it("keeps Take control in view while the bot waits on the person", async () => {
    await act(async () => root.render(createElement(BrowserComputerScreen, { bot: { ...bot, tasks: [{ threadId: "t", activity: "waiting-on-you" }] } as unknown as Bot })));
    await showFrame();
    expect(document.querySelector("[data-take-control-pill]")?.getAttribute("data-take-control-pill")).toBe("shown");
    expect(document.querySelector("[data-take-control-pill]")?.className).toContain("opacity-100");
    expect(document.querySelector("[data-take-control-pill]")?.className).not.toContain("opacity-0");
  });

  it("closes on Escape outside the page, ends the live connection and resumes the preview", async () => {
    await render();
    await showFrame();
    await takeControl();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector("[data-sandbox-takeover]")).toBeNull();
    expect(live()[0]!.closed).toBe(true);
    expect(preview()).toHaveLength(2);
    expect(preview()[1]!.closed).toBe(false);
  });

  it("the close button hands control back the same way", async () => {
    await render();
    await showFrame();
    await takeControl();
    await act(async () => { (document.querySelector("[data-takeover-close]") as HTMLButtonElement).click(); });
    expect(document.querySelector("[data-sandbox-takeover]")).toBeNull();
    expect(live()[0]!.closed).toBe(true);
  });
});
