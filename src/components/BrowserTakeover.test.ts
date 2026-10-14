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
    expect(document.querySelector("[data-browser-preview] [data-take-control]")?.textContent).toContain("Take control");
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

  it("releases control in the window, then takes it again", async () => {
    await render();
    await showFrame();
    await takeControl();
    const toggle = () => document.querySelector("[data-takeover-control]") as HTMLButtonElement;
    expect(toggle().getAttribute("data-takeover-control")).toBe("release");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("data-takeover-control")).toBe("take");
    expect(document.body.textContent).toContain("Watching, read-only");
    await act(async () => toggle().click());
    expect(toggle().getAttribute("data-takeover-control")).toBe("release");
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
