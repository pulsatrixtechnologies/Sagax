// @vitest-environment happy-dom
// The Connect apps pill (2026-10-15, JC, after the reference design): under the last
// message, on the person's side, a wide pill then up to three app icons; it
// opens Connect apps on those apps. When it shows: connect-apps-signal.test.ts.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { initialState, reducer } from "@/state/store";
import { readFileSync } from "node:fs";

import { ConnectAppsPill, pillFit, SidebarConnectApps, sidebarPillApps, sidebarTilesWidth, tilesWidth, type PillApp } from "./ConnectAppsPill";

const inventory = vi.hoisted(() => ({ services: {} as Record<string, { connected: boolean }> }));
vi.mock("./plugins/connected-apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plugins/connected-apps")>()),
  preloadConnectedApps: async () => ({ services: inventory.services, authoritative: true }),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  api: async () => ({ cards: [{ slug: "notion", label: "Notion", blurb: "", logo: null, domain: "notion.so" }] }),
}));

let root: Root | null = null;
const app = (slug: string, label: string): PillApp => ({ slug, label, logo: null, domain: `${slug}.com` });
const apps = [app("gmail", "Gmail"), app("notion", "Notion"), app("googledrive", "Google Drive"), app("slack", "Slack")];

function render(list: PillApp[], onOpen = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(ConnectAppsPill, { apps: list, onOpen })));
  return container;
}

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

describe("the Connect apps pill", () => {
  it("reads Connect apps with three app icons at most, on the person's side", () => {
    const container = render(apps);
    const pill = container.querySelector("[data-connect-apps-pill]")!;
    expect(pill.className).toContain("justify-end");
    const button = pill.querySelector("button")!;
    expect(button.textContent).toBe("Connect apps");
    expect(button.className).toContain("rounded-full");
    expect(button.querySelectorAll("img")).toHaveLength(3);
    expect(button.getAttribute("aria-label")).toBe("Connect apps: Gmail, Notion, Google Drive, Slack");
  });

  it("says Connecter des applications in French", () => {
    setLocale("fr");
    const container = render(apps.slice(0, 1));
    expect(container.querySelector("button")!.textContent).toBe("Connecter des applications");
  });

  it("opens Connect apps when clicked, and draws nothing without an app", () => {
    const onOpen = vi.fn();
    const container = render(apps, onOpen);
    flushSync(() => container.querySelector("button")!.click());
    expect(onOpen).toHaveBeenCalledOnce();
    root?.unmount();
    expect(render([]).querySelector("[data-connect-apps-pill]")).toBeNull();
  });
});

describe("the sidebar's Connect apps pill", () => {
  function renderSidebar(onOpen = vi.fn(), iconOnly = false) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    flushSync(() => root!.render(createElement(SidebarConnectApps, { onOpen, iconOnly })));
    return container;
  }

  it("is a compact tiles pill that names itself in full and opens Connect apps", () => {
    inventory.services = {};
    const onOpen = vi.fn();
    const container = renderSidebar(onOpen);
    const button = container.querySelector<HTMLButtonElement>("[data-sidebar-connect-apps]")!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Connect apps");
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("sidebar-apps-pill");
    expect(button.className).toContain("focus-visible:ring-2");
    // the label is there to slide in on hover and focus, hidden from the
    // accessibility tree (the button's own name says it)
    const label = button.querySelector("[data-apps-pill-label]")!;
    expect(label.textContent).toBe("Connect apps");
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(button.querySelectorAll("[data-pill-tile]").length).toBe(3);
    expect(button.getAttribute("data-tour")).toBe("nav-apps");
    flushSync(() => button.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("widens on hover and keyboard focus only, at once under reduced motion", () => {
    const css = readFileSync("src/styles.css", "utf8");
    // a focus a click left behind never holds it open
    expect(css).toContain(".sidebar-apps-pill:is(:hover, :focus-visible:not([data-pointer-focus])) [data-apps-pill-label]");
    expect(css).not.toContain(".sidebar-apps-pill:is(:hover, :focus-visible) [data-apps-pill-label]");
    // at rest the label takes no width at all
    expect(css).toMatch(/\.sidebar-apps-pill \[data-apps-pill-label\] \{\s*max-width: 0;\s*opacity: 0;\s*margin-inline-end: 0;/);
    // it may give its label up, never its place in the row first
    expect(css).toMatch(/\.sidebar-apps-pill \{\s*flex: 0 1 auto;/);
    // open, the label always gets 6rem (the English one whole), and past that
    // what leaves the account pill its avatar and about three characters
    expect(css).toMatch(/\[data-apps-pill-label\] \{\s*max-width: max\(6rem, calc\(100cqw - 148px\)\);\s*opacity: 1;\s*margin-inline-end: 6px;/);
    // the width moves only when motion is allowed
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*:root:not\(\[data-reduced-motion="true"\]\) \.sidebar-apps-pill \[data-apps-pill-label\] \{\s*transition: max-width 220ms ease/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.sidebar-apps-pill \[data-apps-pill-label\] \{\s*transition: none;/);
    expect(css).toMatch(/:root\[data-reduced-motion="true"\] \.sidebar-apps-pill \[data-apps-pill-label\] \{\s*transition: none;/);
  });

  it("keeps its tiles whole and marks a focus that came from a click", () => {
    inventory.services = {};
    const button = renderSidebar().querySelector<HTMLButtonElement>("[data-sidebar-connect-apps]")!;
    // never narrower than its three tiles and its padding; at rest the tiles
    // sit in the middle, the same padding on both sides
    expect(sidebarTilesWidth(3)).toBe(38);
    expect(button.style.minWidth).toBe(`${sidebarTilesWidth(3) + 18}px`);
    expect(button.querySelector<HTMLElement>("[data-pill-tiles]")!.style.width).toBe("38px");
    const tiles = [...button.querySelectorAll<HTMLElement>("[data-pill-tile]")];
    expect(tiles.map((tile) => tile.className.includes("-ml-2"))).toEqual([false, true, true]);
    expect(button.className).toContain("justify-center");
    expect(button.className).toContain("px-2");
    expect(button.className).toContain("min-w-0");
    expect(button.className).not.toContain("shrink-0");
    const label = button.querySelector("[data-apps-pill-label]")!;
    expect(label.className).toContain("text-ellipsis");
    expect(label.className).toContain("min-w-0");
    // the label comes before the tiles, so the tiles never move when it opens
    expect(button.firstElementChild).toBe(label);
    expect(button.lastElementChild?.hasAttribute("data-pill-tiles")).toBe(true);
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(button.hasAttribute("data-pointer-focus")).toBe(true);
    button.focus();
    button.blur();
    expect(button.hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("says Connecter des applications in French", () => {
    setLocale("fr");
    const button = renderSidebar().querySelector("[data-sidebar-connect-apps]")!;
    expect(button.querySelector("[data-apps-pill-label]")!.textContent).toBe("Connecter des applications");
    expect(button.getAttribute("aria-label")).toBe("Connecter des applications");
  });

  it("keeps an icon button in the collapsed rail", () => {
    setLocale("fr");
    const button = renderSidebar(vi.fn(), true).querySelector("[data-sidebar-connect-apps]")!;
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Connecter des applications");
  });

  it("shows the connected apps, three at most, else the usual suggestions", () => {
    expect(sidebarPillApps([], null).map((item) => item.slug)).toEqual(["gmail", "notion", "googledrive"]);
    const cards = new Map([["notion", { slug: "notion", label: "Notion", blurb: "", logo: "https://logo/notion.png", domain: "notion.so" }]]);
    const shown = sidebarPillApps(["slack", "notion", "gmail", "asana"], cards);
    expect(shown.map((item) => item.slug)).toEqual(["asana", "gmail", "notion"]);
    expect(shown[2]).toMatchObject({ label: "Notion", logo: "https://logo/notion.png" });
  });
});

describe("the pill's tiles, after the reference design", () => {
  it("stacks three 18px tiles right after the label, 6px over one another (42px)", () => {
    const button = render(apps).querySelector("button")!;
    const tiles = button.querySelector<HTMLElement>("[data-pill-tiles]")!;
    expect(tiles.previousElementSibling!.textContent).toBe("Connect apps");
    expect(tiles.className).not.toContain("ml-auto");
    expect(tiles.style.width).toBe("42px");
    expect(tilesWidth(3)).toBe(42);
    const each = [...tiles.querySelectorAll<HTMLElement>("[data-pill-tile]")];
    expect(each.map((tile) => tile.dataset.pillTile)).toEqual(["start", "middle", "end"]);
    expect(each.map((tile) => tile.className.includes("-ml-1.5"))).toEqual([false, true, true]);
    for (const tile of each) {
      expect(tile.className).toContain("size-[18px]");
      expect(tile.className).toContain("rounded-[6px]");
      expect(tile.firstElementChild!.className).toContain("bg-white");
      expect(tile.firstElementChild!.className).toContain("border-[0.5px]");
    }
  });

  it("never truncates the label while it fits: tiles go first, then the padding", () => {
    const label = 180;
    expect(pillFit(16 + label + 6 + 42 + 12 + 2, label, 3)).toBe("full");
    expect(pillFit(16 + label + 6 + 42 + 12 + 1, label, 3)).toBe("compact");
    expect(pillFit(12 + label + 12 + 2, label, 3)).toBe("compact");
    expect(pillFit(12 + label + 12 + 1, label, 3)).toBe("snug");
    expect(pillFit(8 + label + 8 + 2, label, 3)).toBe("snug");
    expect(pillFit(8 + label + 8 + 1, label, 3)).toBe("tight");
    expect(pillFit(16 + label + 16 + 2, label, 0)).toBe("full");
    const button = render(apps).querySelector("button")!;
    expect(button.querySelector("span")!.className).toContain("whitespace-nowrap");
    expect(button.querySelector("span")!.className).not.toContain("truncate");
  });

  it("fans the tiles out on hover, and keeps them still with reduced motion", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const motion = css.slice(css.indexOf(".connect-apps-pill {"));
    expect(motion).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(motion).toMatch(/:root:not\(\[data-reduced-motion="true"\]\) \.connect-apps-pill:is\(:hover, :focus-visible\) \[data-pill-tile="start"\] \{\s*transform: translateX\(-3px\) rotate\(-8deg\);/);
    expect(motion).toMatch(/\[data-pill-tile="end"\] \{\s*transform: translateX\(3px\) rotate\(8deg\);/);
    expect(motion).toContain(":root[data-reduced-motion=\"true\"] .connect-apps-pill");
  });
});

describe("opening Connect apps on the apps a conversation needs", () => {
  const closed = initialState;

  it("keeps the apps while the panel is open and forgets them when it closes", () => {
    const opened = reducer(closed, { type: "togglePlugins", open: true, surface: "apps", botId: "maya", focusApps: ["gmail", "notion"] });
    expect(opened).toMatchObject({ pluginsOpen: true, pluginsBotId: "maya", pluginsFocusApps: ["gmail", "notion"] });
    expect(reducer(opened, { type: "togglePlugins", open: true, surface: "mcp" }).pluginsFocusApps).toEqual(["gmail", "notion"]);
    expect(reducer(opened, { type: "togglePlugins", open: false }).pluginsFocusApps).toBeNull();
    expect(reducer(closed, { type: "togglePlugins", open: true }).pluginsFocusApps).toBeNull();
  });
});
